import type { AnchorFingerprint } from '../../shared/schema';

const MAX_NEARBY_LABEL = 40;

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

  const classes = Array.from(element.classList).filter(Boolean).sort();
  const uniqueClassSelector = classes
    .slice(0, 5)
    .flatMap((_, index, values) => combinations(values, index + 1))
    .map((items) => `.${items.map(escapeCss).join('.')}`)
    .find((candidate) => root.querySelectorAll(`${tag}${candidate}`).length === 1);
  const classSelector = uniqueClassSelector ?? (classes.length ? `.${classes.map(escapeCss).join('.')}` : '');
  const plain = `${tag}${classSelector}`;
  if (root.querySelectorAll(plain).length === 1) return plain;

  const siblings = element.parentElement ? Array.from(element.parentElement.children).filter((child) => child.tagName === element.tagName) : [];
  const index = siblings.indexOf(element) + 1;
  return `${plain}:nth-of-type(${Math.max(index, 1)})`;
}

/** Build a short, re-selectable CSS path and local fingerprint for a DOM element. */
export function createAnchorFingerprint(element: Element, root: Document = element.ownerDocument): AnchorFingerprint {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current && current !== root.documentElement.parentElement) {
    segments.unshift(segment(current, root));
    const candidate = segments.join(' > ');
    if (root.querySelectorAll(candidate).length === 1) break;
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

export function findByFingerprint(root: Document, fingerprint: AnchorFingerprint): Element | null {
  const candidates = Array.from(root.querySelectorAll('*')).filter((element) => matchesFingerprint(element, fingerprint));
  return candidates.length === 1 ? candidates[0] : null;
}

export function buildCssPath(element: Element, root: Document = element.ownerDocument): string {
  return createAnchorFingerprint(element, root).selectors[0] ?? '';
}

export const fingerprintElement = createAnchorFingerprint;
