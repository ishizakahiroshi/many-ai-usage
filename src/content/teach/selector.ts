import type { AnchorFingerprint } from '../../shared/schema';

const MAX_NEARBY_LABEL = 40;
/** Tailwind / utility classes change often on SPAs (Grok/Codex) — do not put them in taught selectors. */
const UTILITY_CLASS = /^(?:!)?(?:sm:|md:|lg:|xl:|2xl:)?(?:flex|inline-flex|inline|block|grid|contents|hidden|items-|justify-|self-|text-|font-|leading-|tracking-|gap-|space-|p[trblxy]?-|m[trblxy]?-|w-|h-|min-|max-|rounded|border|bg-|shadow|opacity|overflow|truncate|tabular|whitespace|col-|row-|grow|shrink|basis-|z-|top-|left-|right-|bottom-|inset-|relative|absolute|fixed|sticky|pointer-|select-|cursor-|transition|duration|ease-|animate-|ring-|outline-|sr-only|not-sr-only)/i;

const MAX_FINGERPRINT_SCAN = 6_000;

function stableText(value: string): string {
  return value.replace(/-?\d+(?:[,.]\d+)?\s*%?/g, '#').replace(/\s+/g, ' ').trim();
}

function escapeCss(value: string): string {
  const cssEscape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  if (cssEscape) return cssEscape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
}

/** A small deterministic hash used only as a local DOM fingerprint. */
export function textFingerprint(value: string): string {
  let hash = 2166136261;
  for (const character of stableText(value).slice(0, 240)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function nearbyText(element: Element): string {
  const own = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const aria = element.getAttribute('aria-label')?.trim() ?? '';
  const parent = element.parentElement?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const value = aria || (parent !== own ? parent : own);
  return value.slice(0, MAX_NEARBY_LABEL);
}

function meaningfulClasses(element: Element): string[] {
  return Array.from(element.classList)
    .filter((name) => Boolean(name) && !UTILITY_CLASS.test(name) && name.length < 48)
    .sort();
}

function combinations(values: string[], size: number): string[][] {
  if (size === 0) return [[]];
  if (values.length < size) return [];
  const result: string[][] = [];
  for (let index = 0; index <= values.length - size; index += 1) {
    for (const rest of combinations(values.slice(index + 1), size - 1)) result.push([values[index], ...rest]);
  }
  return result;
}

function segment(element: Element, root: Document): string {
  const tag = element.tagName.toLowerCase();
  const id = element.getAttribute('id');
  if (id && root.querySelectorAll(`#${escapeCss(id)}`).length === 1) return `${tag}#${escapeCss(id)}`;

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const ariaSel = `${tag}[aria-label="${escapeCss(ariaLabel)}"]`;
    try {
      if (root.querySelectorAll(ariaSel).length === 1) return ariaSel;
    } catch {
      /* ignore invalid */
    }
  }

  // Prefer stable semantic classes only — never bake Tailwind utility soup into taught selectors.
  const classes = meaningfulClasses(element);
  const uniqueClassSelector = classes
    .slice(0, 4)
    .flatMap((_, index, values) => combinations(values, index + 1))
    .map((items) => `.${items.map(escapeCss).join('.')}`)
    .find((candidate) => root.querySelectorAll(`${tag}${candidate}`).length === 1);
  if (uniqueClassSelector) {
    const withClass = `${tag}${uniqueClassSelector}`;
    if (root.querySelectorAll(withClass).length === 1) return withClass;
  }

  // Structural fallback (no utility classes) — survives Grok/Codex class churn better.
  const siblings = element.parentElement
    ? Array.from(element.parentElement.children).filter((child) => child.tagName === element.tagName)
    : [];
  const index = siblings.indexOf(element) + 1;
  return `${tag}:nth-of-type(${Math.max(index, 1)})`;
}

/** Build a short, re-selectable CSS path and local fingerprint for a DOM element. */
export function createAnchorFingerprint(element: Element, root: Document = element.ownerDocument): AnchorFingerprint {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== root.documentElement.parentElement) {
    segments.unshift(segment(current, root));
    const candidate = segments.join(' > ');
    try {
      if (root.querySelectorAll(candidate).length === 1) break;
    } catch {
      /* keep walking */
    }
    current = current.parentElement;
  }
  const selector = segments.join(' > ');
  return {
    selectors: selector ? [selector] : [],
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role') ?? undefined,
    textFingerprint: textFingerprint(element.textContent ?? ''),
    nearbyLabel: nearbyText(element),
  };
}

export const selectorForElement = createAnchorFingerprint;
export const buildAnchorFingerprint = createAnchorFingerprint;

export function matchesFingerprint(element: Element, fingerprint: AnchorFingerprint): boolean {
  if (fingerprint.tagName && element.tagName.toLowerCase() !== fingerprint.tagName.toLowerCase()) return false;
  if (fingerprint.role && element.getAttribute('role') !== fingerprint.role) return false;
  if (fingerprint.textFingerprint && textFingerprint(element.textContent ?? '') !== fingerprint.textFingerprint) return false;
  if (fingerprint.nearbyLabel) {
    const label = nearbyText(element);
    if (!stableText(label).includes(stableText(fingerprint.nearbyLabel.slice(0, 20)))) return false;
  }
  return true;
}

function walkElements(root: Document | Element, budget: number, visit: (element: Element) => boolean): void {
  const start = root instanceof Document ? root.body ?? root.documentElement : root;
  if (!start) return;
  const walker = (root instanceof Document ? root : root.ownerDocument).createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
  let count = 0;
  let node: Node | null = walker.currentNode;
  // Include start node
  if (node && node.nodeType === Node.ELEMENT_NODE) {
    if (!visit(node as Element)) return;
    count += 1;
  }
  while (count < budget && (node = walker.nextNode())) {
    if (!visit(node as Element)) return;
    count += 1;
  }
}

export function findByFingerprint(root: Document, fingerprint: AnchorFingerprint): Element | null {
  const candidates: Element[] = [];
  walkElements(root, MAX_FINGERPRINT_SCAN, (element) => {
    if (matchesFingerprint(element, fingerprint)) candidates.push(element);
    return true;
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  // Prefer the most compact match when SPA re-renders leave multiple fingerprint hits.
  return candidates.sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0] ?? null;
}

/**
 * Soft recovery when CSS selectors and exact fingerprints break after SPA re-renders.
 * Matches compact nodes whose stable text still includes the taught label / nearby label.
 */
export function findByLabelHint(
  root: Document,
  hints: Array<string | undefined | null>,
  preferredTag?: string,
): Element | null {
  const needles = hints
    .map((hint) => stableText((hint ?? '').slice(0, 40)))
    .filter((hint) => hint.length >= 2);
  if (needles.length === 0) return null;
  const hits: Element[] = [];
  walkElements(root, MAX_FINGERPRINT_SCAN, (element) => {
    if (preferredTag && element.tagName.toLowerCase() !== preferredTag.toLowerCase()) return true;
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > 100) return true;
    const stable = stableText(text);
    if (!needles.some((needle) => stable.includes(needle))) return true;
    // Prefer leaves / shallow nodes that actually look like a metric chip.
    if (element.childElementCount > 6) return true;
    hits.push(element);
    return true;
  });
  if (hits.length === 0) return null;
  return hits.sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0] ?? null;
}

/**
 * Last-resort recovery for usage dashboards (Grok SuperGrok card, etc.):
 * pick a compact node that looks like a page total ("52% 使用済" / "85% 残り").
 * Prefer nodes that carry both a percent and the summary word (not bare "使用済" labels).
 */
export function findUsageHeadline(root: Document): Element | null {
  const scored: Array<{ el: Element; score: number }> = [];
  walkElements(root, MAX_FINGERPRINT_SCAN, (element) => {
    if (element.childElementCount > 8) return true;
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > 80) return true;
    if (!/\d+(?:[.,]\d+)?\s*%/.test(text)) return true;
    let score = 0;
    if (/使用済|使用済み/i.test(text)) score += 100;
    if (/残り|remaining/i.test(text)) score += 80;
    if (/(?:used|usage)\b/i.test(text) && !/(?:Grok\s*Build|チャット|Chat\b|API\b)/i.test(text)) score += 60;
    // Demote legend chips under SuperGrok.
    if (/(?:Grok\s*Build|チャット|Chat\b|API\b|Code\s*Review|コードレビュー)/i.test(text)) score -= 90;
    if (score <= 0) return true;
    // Prefer compact leaves that own the number.
    score += element.childElementCount === 0 ? 20 : Math.max(0, 10 - element.childElementCount);
    score -= Math.min(text.length, 40);
    scored.push({ el: element, score });
    return true;
  });
  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score);
    return scored[0]!.el;
  }
  const used = findByLabelHint(root, ['使用済', '使用済み']);
  if (used) return used;
  const remaining = findByLabelHint(root, ['残り', 'remaining']);
  if (remaining) return remaining;
  return findByLabelHint(root, ['used', 'usage']);
}

export function buildCssPath(element: Element, root: Document = element.ownerDocument): string {
  return createAnchorFingerprint(element, root).selectors[0] ?? '';
}

export const fingerprintElement = createAnchorFingerprint;
