import type { MetricKind, MetricUnit, TaughtMetric } from '../../shared/schema';
import { diagLog, obsLog, perfLog, perfNow } from '../../shared/perf';
import { createAnchorFingerprint, textFingerprint } from './selector';
import { extractValue, type ExtractedValue } from './extract';
import { inferResetLive, isResetLabelText } from './reset';

let pickerHost: HTMLElement | null = null;
let pickerDocStyle: HTMLStyleElement | null = null;
let topLayerTimers: number[] = [];
let restackIntervalId: number | null = null;
let tooltip: HTMLDivElement | null = null;
let panel: HTMLDivElement | null = null;
/** Orange marker drawn in our top-layer shadow (page style.outline is wiped by React). */
let highlightBox: HTMLDivElement | null = null;
let pickerShadowRoot: ShadowRoot | null = null;
let highlighted: Element | null = null;
/** Throttle hover diagnostics (mousemove is hot). */
let lastHoverDiagAt = 0;
let lastHoverDiagKey = '';
let activeProviderId: string | null = null;
let initialMetricId: string | undefined;
let activePickerMode: 'metrics' | 'reset' = 'metrics';
let savedMetrics: TaughtMetric[] = [];
let saving = false;
/** Suppress the trailing `click` after a successful `pointerdown` select (same gesture). */
let lastSelectAt = 0;
let lastSelectX = 0;
let lastSelectY = 0;
/** Deduplicate window+host capture listeners for the same physical gesture. */
let lastHandledEventStamp = 0;
let statusHint: string | null = null;
let savingResetTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Last element that produced a tooltip value on hover.
 * Click hit-testing can miss under popover top-layer / SPA pointer capture;
 * staging uses this when the click is near the hover point (Codex/ChatGPT).
 */
let lastHoverHit: { x: number; y: number; element: Element; extracted: ExtractedValue } | null = null;

function isPickerChrome(element: Element): boolean {
  if (!pickerHost) return false;
  if (element === pickerHost || pickerHost.contains(element)) return true;
  if (panel && (element === panel || panel.contains(element))) return true;
  if (tooltip && (element === tooltip || tooltip.contains(element))) return true;
  if (highlightBox && (element === highlightBox || highlightBox.contains(element))) return true;
  return false;
}

/** jsdom (and some offscreen nodes) report an empty box — treat layout as unknown. */
function isLayoutUnknown(rect: DOMRect): boolean {
  return rect.width <= 0 && rect.height <= 0;
}

function rectContainsPoint(rect: DOMRect, x: number, y: number, pad = 2): boolean {
  if (isLayoutUnknown(rect)) return true;
  return x >= rect.left - pad
    && x <= rect.right + pad
    && y >= rect.top - pad
    && y <= rect.bottom + pad;
}

/**
 * Hit-test stack under the cursor.
 * Host stays pointer-events:none (only the panel is interactive), so we do not need
 * showModal inert workarounds — modal dialogs made Grok's sheet unhittable.
 */
function hitStackAtPoint(x: number, y: number): Element[] {
  if (!pickerHost) return [];
  // Belt-and-suspenders: never let our chrome intercept hit-testing.
  pickerHost.style.pointerEvents = 'none';
  if (panel) panel.style.pointerEvents = 'auto';
  const stack: Element[] = [];
  const primary = document.elementFromPoint(x, y);
  if (primary) stack.push(primary);
  if (typeof document.elementsFromPoint === 'function') {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!stack.includes(el)) stack.push(el);
    }
  }
  return stack.filter((element) => element && !isPickerChrome(element));
}

/** Hit-test the page under the full-screen picker host (temporarily disables host pointer events). */
function elementAtPoint(x: number, y: number): Element | null {
  return hitStackAtPoint(x, y)[0] ?? null;
}

/**
 * Elements under the cursor, including compact children that actually contain the point.
 * Without digging, Grok cards often hit a full-width progress shell and lock to the whole card.
 */
function candidatesAtPoint(x: number, y: number): Element[] {
  const stack = hitStackAtPoint(x, y);
  const out: Element[] = [];
  const seen = new Set<Element>();
  const push = (el: Element | null | undefined) => {
    if (!el || seen.has(el) || isPickerChrome(el)) return;
    if (el === document.body || el === document.documentElement) return;
    seen.add(el);
    out.push(el);
  };

  for (const hit of stack) {
    push(hit);
    // Dig into children whose box still contains the pointer (card → chip).
    const queue: Element[] = [hit];
    let steps = 0;
    while (queue.length > 0 && steps < 48) {
      const node = queue.shift()!;
      steps += 1;
      const kids = node.children;
      const kidCount = kids.length;
      // When layout is unknown (jsdom), sample a shallow prefix instead of geometry filter.
      const layoutUnknown = isLayoutUnknown(node.getBoundingClientRect());
      const limit = layoutUnknown ? Math.min(kidCount, 24) : kidCount;
      for (let i = 0; i < limit; i += 1) {
        const child = kids[i]!;
        const rect = child.getBoundingClientRect();
        if (!layoutUnknown) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (!rectContainsPoint(rect, x, y, 4)) continue;
        }
        push(child);
        // Prefer exploring smaller children first so chips beat giant shells.
        if (child.childElementCount > 0 && child.childElementCount <= 40) {
          queue.push(child);
        }
      }
    }
    // Limited ancestors for label/value pairing — stop before full modal.
    let parent = hit.parentElement;
    for (let depth = 0; depth < 5 && parent; depth += 1, parent = parent.parentElement) {
      if (parent === document.body || parent === document.documentElement) break;
      const rect = parent.getBoundingClientRect();
      if (rect.width * rect.height > 280_000) break;
      push(parent);
      if (parent.childElementCount <= 16) {
        for (const sibling of Array.from(parent.children).slice(0, 16)) {
          const sRect = sibling.getBoundingClientRect();
          // Only siblings that still cover the pointer (or are tight chips near it).
          if (rectContainsPoint(sRect, x, y, 12) || (sRect.width * sRect.height < 24_000 && Math.hypot(
            x - (sRect.left + sRect.width / 2),
            y - (sRect.top + sRect.height / 2),
          ) < 64)) {
            push(sibling);
            for (const grand of Array.from(sibling.children).slice(0, 10)) push(grand);
          }
        }
      }
    }
  }
  return out;
}

/** Prefer live hit-test; fall back to the hover-previewed node near the click. */
function resolveSelectElement(clientX: number, clientY: number): Element | null {
  const { element, extracted } = bestExtractAtPoint(clientX, clientY);
  if (element && extracted.value != null) return element;
  if (
    lastHoverHit
    && document.contains(lastHoverHit.element)
    && Math.hypot(clientX - lastHoverHit.x, clientY - lastHoverHit.y) < 56
  ) {
    return lastHoverHit.element;
  }
  return element ?? elementAtPoint(clientX, clientY);
}

function isPanelEvent(event: Event): boolean {
  return panel != null && event.composedPath().includes(panel);
}

function applySavedMetrics(response: { saved?: boolean; metrics?: TaughtMetric[] } | undefined, fallback: TaughtMetric[]): void {
  // Empty arrays are truthy, so never use `response.metrics ?? fallback` — a failed SAVE returns metrics: [].
  savedMetrics = response?.saved && Array.isArray(response.metrics) ? response.metrics : fallback;
  renderPanel();
}

function ensureHighlightBox(): HTMLDivElement | null {
  if (highlightBox) return highlightBox;
  if (!pickerShadowRoot) return null;
  highlightBox = document.createElement('div');
  highlightBox.className = 'highlight-box';
  highlightBox.setAttribute('aria-hidden', 'true');
  pickerShadowRoot.append(highlightBox);
  return highlightBox;
}

/** Draw marker in our top-layer UI — do not touch page element styles (SPA re-renders clear them). */
function setHighlight(element: Element | null): void {
  highlighted = element;
  const box = ensureHighlightBox();
  if (!box) {
    if (element) diagLog('picker.highlight.no-box', { hasShadow: Boolean(pickerShadowRoot) });
    return;
  }
  if (!element || !(element instanceof Element) || !document.contains(element)) {
    box.style.display = 'none';
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    box.style.display = 'none';
    diagLog('picker.highlight.zero-rect', {
      tag: element.tagName.toLowerCase(),
      childElementCount: element.childElementCount,
    });
    return;
  }
  const pad = 3;
  box.style.display = 'block';
  box.style.left = `${Math.max(0, rect.left - pad)}px`;
  box.style.top = `${Math.max(0, rect.top - pad)}px`;
  box.style.width = `${rect.width + pad * 2}px`;
  box.style.height = `${rect.height + pad * 2}px`;
}

function logHoverDiag(
  x: number,
  y: number,
  stackLen: number,
  element: Element | null,
  extracted: ExtractedValue | null,
): void {
  const now = Date.now();
  if (now - lastHoverDiagAt < 700) return;
  const rect = element?.getBoundingClientRect();
  const key = [
    stackLen,
    element?.tagName ?? 'none',
    extracted?.value != null ? 'v' : 'nv',
    extracted?.unit ?? '-',
    highlightBox?.style.display ?? 'no-box',
    Math.round(rect?.width ?? 0),
    Math.round(rect?.height ?? 0),
  ].join('|');
  if (key === lastHoverDiagKey && now - lastHoverDiagAt < 2_500) return;
  lastHoverDiagAt = now;
  lastHoverDiagKey = key;
  let hostOpen: boolean | null = null;
  if (pickerHost && typeof pickerHost.matches === 'function') {
    try {
      hostOpen = pickerHost.matches(':popover-open');
    } catch {
      hostOpen = null;
    }
  }
  diagLog('picker.hover', {
    stackLen,
    hitTag: element?.tagName.toLowerCase() ?? null,
    hitChildren: element?.childElementCount ?? null,
    valuePresent: extracted?.value != null,
    unit: extracted?.unit ?? null,
    hasPercent: extracted ? /%/.test(extracted.evidence) : false,
    hasUsedWord: extracted ? /使用済|使用済み|used/i.test(extracted.evidence) : false,
    evidenceLen: extracted?.evidence.length ?? 0,
    area: rect ? Math.round(rect.width * rect.height) : null,
    boxDisplay: highlightBox?.style.display ?? 'missing',
    popoverOpen: hostOpen,
    x: Math.round(x),
    y: Math.round(y),
  });
}

function isCompactUsageHit(element: Element, extracted: ExtractedValue): boolean {
  if (extracted.value == null) return false;
  if (element.childElementCount <= 1) return true;
  const own = ownDirectText(element);
  if (looksLikeCompactUsageText(own)) return true;
  if (extracted.evidence.length <= 48 && /\d/.test(extracted.evidence) && element.childElementCount <= 4) return true;
  return false;
}

/**
 * Hover/click preview at a point: pick a *compact* usage chip under the cursor
 * (使用済 / legend %), never the whole SuperGrok card when inner objects exist.
 */
function bestExtractAtPoint(x: number, y: number): { element: Element | null; extracted: ExtractedValue } {
  const candidates = candidatesAtPoint(x, y);
  if (candidates.length === 0) {
    return { element: null, extracted: { value: null, used: null, remaining: null, total: null, unit: 'custom', evidence: '', semanticSignals: [] } };
  }
  const hit = candidates[0]!;
  const hitExtracted = extractValue(hit);
  // User pointed at a leaf chip ("Grok Build 1%" / "62% 使用済") — keep it; do not climb to the card.
  if (isCompactUsageHit(hit, hitExtracted)) {
    return { element: hit, extracted: hitExtracted };
  }
  let bestElement: Element = hit;
  let best = hitExtracted;
  let bestScore = scoreHoverCandidate(x, y, hit, hit, best);
  for (const candidate of candidates) {
    if (!safeToExtractValue(candidate) && candidate !== hit) continue;
    const extracted = extractValue(candidate);
    const score = scoreHoverCandidate(x, y, hit, candidate, extracted);
    if (score > bestScore) {
      bestScore = score;
      best = extracted;
      bestElement = candidate;
    }
  }
  // Large shell still won (empty bar / title padding): refine down to headline chip.
  const bestRect = bestElement.getBoundingClientRect();
  const bestArea = isLayoutUnknown(bestRect) ? 0 : bestRect.width * bestRect.height;
  const shouldRefine = best.value != null
    && !isCompactUsageHit(bestElement, best)
    && (bestArea > 48_000 || bestElement.childElementCount > 4);
  if (shouldRefine) {
    const refined = refineValueElement(bestElement);
    if (refined !== bestElement) {
      const refinedExtract = extractValue(refined);
      if (refinedExtract.value != null) {
        return { element: refined, extracted: refinedExtract };
      }
    }
  }
  return { element: bestElement, extracted: best };
}

/** @deprecated internal alias — tests may still import via hover path */
function bestHoverExtract(hit: Element): { element: Element; extracted: ExtractedValue } {
  const rect = hit.getBoundingClientRect();
  const x = rect.left + Math.min(rect.width / 2, 8);
  const y = rect.top + Math.min(rect.height / 2, 8);
  const atPoint = bestExtractAtPoint(x, y);
  if (atPoint.element) return { element: atPoint.element, extracted: atPoint.extracted };
  return { element: hit, extracted: extractValue(hit) };
}

function scoreHoverCandidate(
  x: number,
  y: number,
  hit: Element,
  element: Element,
  extracted: ExtractedValue,
): number {
  if (extracted.value == null) return -1_000;
  const rect = element.getBoundingClientRect();
  const layoutUnknown = isLayoutUnknown(rect);
  const area = layoutUnknown ? 0 : Math.max(1, rect.width * rect.height);
  const containsPointer = rectContainsPoint(rect, x, y, 6);
  let score = 0;
  if (extracted.unit === 'percent') score += 55;
  if (/%/.test(extracted.evidence)) score += 35;
  if (/使用済|使用済み/i.test(extracted.evidence)) score += 55;
  if (/残り|remaining|used|上限/i.test(extracted.evidence)) score += 25;
  // Reject "whole modal / whole card" selections — user must pick inner objects.
  if (!layoutUnknown) {
    if (area > 220_000) score -= 180;
    else if (area > 100_000) score -= 100;
    else if (area > 48_000) score -= 55;
    else if (area > 24_000) score -= 20;
    if (rect.height > 120) score -= 45;
    if (rect.width > 420) score -= 35;
    // Prefer tight chips (text-sized).
    if (rect.height > 0 && rect.height <= 56 && rect.width <= 320) score += 45;
    if (rect.height > 0 && rect.height <= 32 && rect.width <= 200) score += 20;
  }
  // Bare 0 on a progress shell / empty aria — almost never the taught metric.
  if (extracted.value === 0) {
    if (!/%|使用|残り|remaining/i.test(extracted.evidence)) score -= 80;
    else score -= 25;
  }
  // Prefer compact own evidence (not a blob of the whole card text).
  score -= Math.min(extracted.evidence.length, 120) * 0.35;
  // Prefer leaves / shallow nodes.
  score += element.childElementCount === 0 ? 18 : Math.max(0, 10 - element.childElementCount);
  // Must cover the pointer when possible — enables chip-vs-chip selection inside a card.
  if (containsPointer) score += 50;
  else score -= 30;
  // Prefer the top hit and its descendants; demote card ancestors so chips win.
  if (element === hit) score += 55;
  else if (hit.contains(element)) score += 35;
  else if (element.contains(hit)) score -= 55;
  else score -= 12;
  // Compact leaf under the pointer beats a card summary that merely wraps it.
  if (isCompactUsageHit(element, extracted) && containsPointer) score += 40;
  // Breakdown legend chips stay selectable when the pointer is on them.
  if (isBreakdownLegendText(extracted.evidence) && containsPointer) score += 20;
  return score;
}

function unitKind(unit: MetricUnit): MetricKind {
  if (unit === 'percent') return 'percent';
  if (['requests', 'credits', 'tokens', 'sessions'].includes(unit)) return 'count';
  return 'amount';
}

function cleanLabel(value: string): string {
  return value
    .replace(/(?:\b(?:reset|resets|renew|renews)\b|リセット|更新|下次).*$/i, '')
    .replace(/\$?\s*-?\d+(?:[,.]\d+)?(?:\s*\/\s*\$?\s*-?\d+(?:[,.]\d+)?)?\s*%?/g, ' ')
    .replace(/\b(?:requests?|credits?|tokens?|sessions?|remaining|left|used)\b|リクエスト|クレジット|トークン|セッション|残り|使用/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function metricLabel(element: Element, fallback: string): string {
  const candidates = [
    element.getAttribute('aria-label') ?? '',
    element.previousElementSibling?.textContent ?? '',
    element.parentElement?.previousElementSibling?.textContent ?? '',
    element.parentElement?.textContent ?? '',
    fallback,
  ];
  return candidates.map(cleanLabel).find((value) => value.length >= 2)?.slice(0, 80) ?? 'Taught metric';
}

function formatExtracted(extracted: ExtractedValue): string {
  if (extracted.value == null) return 'Choose a visible usage value';
  if (extracted.semanticSignals.includes('used-total') && extracted.total != null) {
    return `${extracted.value} / ${extracted.total}${extracted.unit === 'custom' ? '' : ` ${extracted.unit}`}`;
  }
  if (extracted.unit === 'percent') return `${extracted.value} %`;
  if (extracted.unit === 'dollars') return `$${extracted.value}`;
  return `${extracted.value}${extracted.unit === 'custom' ? '' : ` ${extracted.unit}`}`;
}

function resetCandidate(element: Element): boolean {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  return isResetLabelText(text);
}

/** Max nodes we will run extractValue on during refine (large SPA shells can be 10k+). */
const REFINE_EXTRACT_BUDGET = 80;
/** Do not descend into a child that already owns this many element children (chat threads). */
const REFINE_HUGE_CHILD = 200;
/** Direct children sampled under a huge node (usage labels sit near the top of cards). */
const REFINE_HUGE_SAMPLE = 40;

/** Text nodes only — avoids walking huge descendant textContent. */
function ownDirectText(element: Element): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    text += child.textContent ?? '';
    if (text.length > 120) break;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Cheap gate: full extractValue on a huge subtree freezes teach on Grok-like SPAs. */
function safeToExtractValue(element: Element): boolean {
  if (element.hasAttribute('aria-valuenow') || element.tagName.toLowerCase() === 'progress') return true;
  if (element.childElementCount > 24) return false;
  let nested = 0;
  for (const child of element.children) {
    nested += child.childElementCount;
    if (nested > 64) return false;
  }
  return true;
}

function looksLikeCompactUsageText(text: string): boolean {
  if (!text || text.length > 80) return false;
  if (/\d+(?:[.,]\d+)?\s*%/.test(text)) return true;
  if (/\d+\s*\/\s*\d+/.test(text)) return true;
  if (/\$\s*-?\d/.test(text) && text.length <= 48) return true;
  if (/\d+(?:[.,]\d+)?\s*(?:credits?|requests?|tokens?|sessions?|クレジット|リクエスト|トークン|セッション|残り|使用)/i.test(text) && text.length <= 48) {
    return true;
  }
  return false;
}

/**
 * Bounded candidate collection for refine.
 * Prefer compact usage-like leaves; never querySelectorAll('*') on the whole shell.
 */
export function collectRefineCandidates(root: Element, budget = REFINE_EXTRACT_BUDGET): Element[] {
  const preferred: Element[] = [];
  const fallback: Element[] = [];

  const consider = (el: Element): void => {
    if (el !== root && looksLikeCompactUsageText(ownDirectText(el))) preferred.push(el);
    else if (el.hasAttribute('aria-valuenow') || el.tagName.toLowerCase() === 'progress') preferred.push(el);
    else if (fallback.length < budget) fallback.push(el);
  };

  const visit = (el: Element, depth: number): void => {
    if (preferred.length >= budget) return;
    if (el !== root) consider(el);

    // Avoid Array.from on huge .children lists (jsdom/browser both pay O(n)).
    const kidCount = el.children.length;
    const kids: Element[] = [];
    for (let i = 0; i < kidCount; i += 1) kids.push(el.children[i]!);
    // Visit smaller subtrees first so usage chips beat giant chat threads.
    kids.sort((left, right) => left.childElementCount - right.childElementCount);

    for (const kid of kids) {
      if (preferred.length >= budget) return;
      if (kid.childElementCount > REFINE_HUGE_CHILD) {
        // Shallow sample only — do not materialize tens of thousands of thread nodes.
        consider(kid);
        const sampleLimit = Math.min(kid.children.length, REFINE_HUGE_SAMPLE);
        for (let i = 0; i < sampleLimit; i += 1) {
          const grand = kid.children[i]!;
          consider(grand);
          const g2Limit = Math.min(grand.children.length, 12);
          for (let j = 0; j < g2Limit; j += 1) consider(grand.children[j]!);
        }
        continue;
      }
      if (depth >= 14) {
        consider(kid);
        continue;
      }
      visit(kid, depth + 1);
    }
  };

  visit(root, 0);

  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const el of [root, ...preferred, ...fallback]) {
    if (seen.has(el)) continue;
    seen.add(el);
    out.push(el);
    if (out.length >= budget) break;
  }
  return out;
}

/**
 * Breakdown legend chips under a usage card (Grok: "Grok Build 44% · チャット 1% · API 1%").
 * Prefer the card headline ("46% 使用済") when the user clicks the whole card.
 */
function isBreakdownLegendText(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!/\d+(?:[.,]\d+)?\s*%/.test(compact)) return false;
  // Product / channel labels next to a % — not the card summary.
  if (/(?:Grok\s*Build|チャット|Chat\b|API\b|Code\s*Review|コードレビュー|内訳)/i.test(compact)) return true;
  // "Label 12%" without summary words, very short — typical legend row.
  if (
    compact.length <= 28
    && !/(?:使用済|使用済み|使用量|remaining|used|残り|上限|limit|quota|週間|weekly|月間|monthly|利用上限)/i.test(compact)
    && /[^\d%.,\s]{2,}/.test(compact)
  ) {
    return true;
  }
  return false;
}

/** Prefer upper / taller nodes inside the clicked region (headline over footer legend). */
function layoutBoost(node: Element, root: Element): number {
  if (!(node instanceof HTMLElement) || !(root instanceof HTMLElement)) return 0;
  const box = node.getBoundingClientRect();
  const rootBox = root.getBoundingClientRect();
  // jsdom often returns zeros — skip layout scoring in that case.
  if (box.height <= 0 && box.width <= 0) return 0;
  let score = Math.min(box.height, 72);
  if (rootBox.height > 1) {
    const midY = (box.top + box.height / 2 - rootBox.top) / rootBox.height;
    score += (1 - Math.min(Math.max(midY, 0), 1)) * 45;
  }
  return score;
}

function scoreUsageCandidate(
  node: Element,
  extracted: ExtractedValue,
  root: Element,
  peers: Array<{ node: Element; extracted: ExtractedValue }>,
): number {
  const text = extracted.evidence.replace(/\s+/g, ' ').trim();
  const rounded = String(Math.round(extracted.value!));
  // extractValue may borrow a nearby parent unit/% — prefer nodes that carry the number themselves.
  const ownMentionsValue = text.includes(rounded) || (extracted.unit === 'percent' && /%/.test(text));
  let score = 0;
  if (ownMentionsValue) score += 80;
  else score -= 60;
  if (extracted.unit === 'percent' || /%/.test(text)) score += 100;
  else if (extracted.unit !== 'custom') score += 50;
  if (extracted.semanticSignals.includes('used-total')) score += 20;
  if (extracted.semanticSignals.includes('remaining') || extracted.semanticSignals.includes('used')) score += 15;
  // Card summary headlines (total used / weekly limit).
  if (/(?:使用済|使用済み|使用量)/i.test(text)) score += 55;
  if (/(?:used|remaining|残り|上限|limit|quota|週間|weekly)/i.test(text)) score += 25;
  // Whole-card click: demote breakdown chips so "チャット 1%" loses to "46% 使用済".
  if (isBreakdownLegendText(text)) score -= 90;
  const legendPeers = peers.filter((peer) => isBreakdownLegendText(peer.extracted.evidence.replace(/\s+/g, ' ').trim()));
  if (legendPeers.length >= 1 && extracted.unit === 'percent' && !isBreakdownLegendText(text)) {
    score += 30;
    // Among summary candidates, the largest % is usually the pool total (46% vs chips).
    const summaryPercents = peers
      .filter((peer) => peer.extracted.unit === 'percent' && peer.extracted.value != null
        && !isBreakdownLegendText(peer.extracted.evidence.replace(/\s+/g, ' ').trim()))
      .map((peer) => peer.extracted.value as number);
    if (summaryPercents.length >= 1 && extracted.value === Math.max(...summaryPercents)) score += 25;
  }
  score -= Math.min(text.length, 40);
  // Prefer leaf-ish nodes (flex row → value span) when text scores tie.
  score += node.childElementCount === 0 ? 8 : 0;
  score += layoutBoost(node, root);
  return score;
}

function isPreferredUsageNode(node: Element, root: Element): boolean {
  if (node === root) return safeToExtractValue(node);
  if (node.hasAttribute('aria-valuenow') || node.tagName.toLowerCase() === 'progress') return true;
  return looksLikeCompactUsageText(ownDirectText(node));
}

/** Prefer the deepest, most usage-like node (avoids teaching whole flex rows or bare labels like "5h"). */
export function refineValueElement(element: Element): Element {
  const startedAt = perfNow();
  const nodes = collectRefineCandidates(element);
  // When compact usage leaves exist, skip extractValue on chat-message fallbacks (freeze source).
  const preferred = nodes.filter((node) => isPreferredUsageNode(node, element));
  const extractPool = (preferred.length > 0 ? preferred : nodes).filter((node) => safeToExtractValue(node));
  const extractedPeers = extractPool
    .map((node) => ({ node, extracted: extractValue(node) }))
    .filter((item) => item.extracted.value != null);
  const scored = extractedPeers
    .map((item) => ({ ...item, score: scoreUsageCandidate(item.node, item.extracted, element, extractedPeers) }))
    .sort((left, right) => right.score - left.score);
  const ms = perfNow() - startedAt;
  // Structural only — tag name + counts + ms (no usage text).
  if (ms >= 30 || nodes.length >= 50 || extractPool.length >= 20) {
    obsLog('picker.refineValueElement', {
      tag: element.tagName.toLowerCase(),
      candidateCount: nodes.length,
      extractCount: extractPool.length,
      hitCount: scored.length,
      topValue: scored[0]?.extracted.value ?? null,
      ms: Math.round(ms),
    });
    perfLog('picker.refineValueElement', startedAt, {
      candidateCount: nodes.length,
      extractCount: extractPool.length,
      hitCount: scored.length,
    }, 30);
  }
  return scored[0]?.node ?? element;
}

export function makeMetric(element: Element, metricId?: string): TaughtMetric {
  const startedAt = perfNow();
  const target = refineValueElement(element);
  const refineMs = perfNow() - startedAt;
  const anchorStartedAt = perfNow();
  const anchor = createAnchorFingerprint(target);
  const anchorMs = perfNow() - anchorStartedAt;
  const extracted = extractValue(target);
  const label = metricLabel(target, anchor.nearbyLabel ?? extracted.evidence);
  const unit = extracted.unit;
  const interpretation = extracted.semanticSignals.includes('used')
    ? (unit === 'percent' ? 'used_percent' : 'used_total')
    : extracted.semanticSignals.includes('remaining') || unit === 'percent'
      ? (unit === 'percent' ? 'remaining_percent' : 'remaining_total')
      : 'absolute_value';
  const resetStartedAt = perfNow();
  const resetLive = inferResetLive(target);
  const resetMs = perfNow() - resetStartedAt;
  const payload = {
    refineMs: Math.round(refineMs),
    anchorMs: Math.round(anchorMs),
    resetMs: Math.round(resetMs),
    hasReset: Boolean(resetLive.resetAnchor),
    hasResetAt: Boolean(resetLive.resetAt),
    childElementCount: element.childElementCount,
    tag: element.tagName.toLowerCase(),
    targetTag: target.tagName.toLowerCase(),
  };
  if (refineMs >= 30 || resetMs >= 30 || !resetLive.resetAt) {
    obsLog('picker.makeMetric', payload);
  }
  perfLog('picker.makeMetric', startedAt, payload, 20);
  return {
    metricId: metricId ?? `taught-${textFingerprint(`${label}:${anchor.selectors[0] ?? ''}`)}`,
    label,
    kind: unitKind(unit),
    unit,
    windowLabel: label,
    valueAnchor: anchor,
    resetAnchor: resetLive.resetAnchor,
    interpretation,
    enabled: true,
  };
}

/** Teach-time reset label/ISO for the live dashboard snapshot (DOM may be gone after Done). */
export function liveResetForElement(element: Element, now = Date.now()): { resetLabel: string | null; resetAt: string | null } {
  const target = refineValueElement(element);
  const live = inferResetLive(target, now);
  return { resetLabel: live.resetLabel, resetAt: live.resetAt };
}

function setStatusHint(message: string | null): void {
  statusHint = message;
  if (!panel) return;
  const hint = panel.querySelector('[data-hint]');
  if (!hint) return;
  if (message) {
    hint.textContent = message;
    return;
  }
  hint.textContent = savedMetrics.length === 0
    ? 'Click a usage number on the page. Then press Done and return.'
    : 'Rename if needed, then press Done and return.';
}

function renderPanel(): void {
  if (!panel) return;
  const list = panel.querySelector('[data-list]');
  const count = panel.querySelector('[data-count]');
  const done = panel.querySelector<HTMLButtonElement>('[data-action="done"]');
  if (!list || !count) return;
  count.textContent = `Saved: ${savedMetrics.length}`;
  if (done) done.disabled = savedMetrics.length === 0;
  setStatusHint(statusHint);
  list.replaceChildren(...savedMetrics.map((metric) => {
    const row = document.createElement('div');
    row.className = 'metric-row';
    const text = document.createElement('span');
    text.textContent = metric.label;
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.textContent = 'Rename';
    rename.dataset.action = 'rename';
    rename.dataset.metricId = metric.metricId;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.dataset.action = 'remove';
    remove.dataset.metricId = metric.metricId;
    row.append(text, rename, remove);
    return row;
  }));
}

function cssEscape(value: string): string {
  const escape = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS?.escape;
  if (escape) return escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character.charCodeAt(0).toString(16)} `);
}

function beginInlineRename(metricId: string, currentLabel: string): void {
  if (!panel) return;
  const list = panel.querySelector('[data-list]');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'metric-row rename-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentLabel;
  input.maxLength = 80;
  input.dataset.renameInput = 'true';
  input.dataset.metricId = metricId;
  input.setAttribute('aria-label', 'Metric name');
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  save.dataset.action = 'rename-save';
  save.dataset.metricId = metricId;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Back';
  cancel.dataset.action = 'rename-cancel';
  row.append(input, save, cancel);
  const existing = list.querySelector(`[data-metric-id="${cssEscape(metricId)}"]`)?.closest('.metric-row');
  if (existing) existing.replaceWith(row);
  else list.prepend(row);
  input.focus();
  input.select();
}

async function cancelPicker(): Promise<void> {
  if (!activeProviderId) return stopPicker();
  const providerId = activeProviderId;
  stopPicker();
  await chrome.runtime.sendMessage({ type: 'CANCEL_TEACH', providerId });
}

async function finishPicker(): Promise<void> {
  if (!activeProviderId || savedMetrics.length === 0) return;
  const providerId = activeProviderId;
  stopPicker();
  await chrome.runtime.sendMessage({ type: 'DONE_TEACH', providerId });
}

async function panelClick(event: Event): Promise<void> {
  event.stopPropagation();
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-action]');
  if (!button || !activeProviderId) return;
  const action = button.dataset.action;
  if (action === 'done') return finishPicker();
  if (action === 'cancel') return cancelPicker();
  if (action === 'rename-cancel') {
    renderPanel();
    return;
  }
  const metricId = button.dataset.metricId;
  if (!metricId) return;
  if (action === 'remove') {
    const response = await chrome.runtime.sendMessage({ type: 'REMOVE_METRIC', providerId: activeProviderId, metricId }) as { metrics?: TaughtMetric[] };
    savedMetrics = response.metrics ?? savedMetrics.filter((metric) => metric.metricId !== metricId);
    renderPanel();
    return;
  }
  if (action === 'rename') {
    const current = savedMetrics.find((metric) => metric.metricId === metricId);
    beginInlineRename(metricId, current?.label ?? '');
    return;
  }
  if (action === 'rename-save') {
    const input = panel?.querySelector<HTMLInputElement>(`input[data-rename-input][data-metric-id="${cssEscape(metricId)}"]`);
    const label = input?.value.trim().slice(0, 80) ?? '';
    if (!label) return;
    const response = await chrome.runtime.sendMessage({ type: 'RENAME_METRIC', providerId: activeProviderId, metricId, label }) as { metrics?: TaughtMetric[] };
    savedMetrics = response.metrics ?? savedMetrics.map((metric) => metric.metricId === metricId ? { ...metric, label, windowLabel: label } : metric);
    renderPanel();
  }
}

function onMove(event: MouseEvent): void {
  if (isPanelEvent(event)) {
    setHighlight(null);
    if (tooltip) tooltip.style.display = 'none';
    return;
  }
  if (activePickerMode === 'reset') {
    const stack = hitStackAtPoint(event.clientX, event.clientY);
    const raw = stack[0] ?? null;
    lastHoverHit = null;
    logHoverDiag(event.clientX, event.clientY, stack.length, raw, raw ? extractValue(raw) : null);
    if (!raw) {
      setHighlight(null);
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 330)}px`;
        tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 40)}px`;
        tooltip.textContent = 'Choose a reset date or countdown';
      }
      return;
    }
    setHighlight(raw);
    if (!tooltip) return;
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 330)}px`;
    tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 40)}px`;
    tooltip.textContent = resetCandidate(raw)
      ? `${(raw.textContent ?? '').replace(/\s+/g, ' ').trim()} · click to use reset`
      : 'Choose a reset date or countdown';
    return;
  }
  const stackLen = hitStackAtPoint(event.clientX, event.clientY).length;
  const { element, extracted } = bestExtractAtPoint(event.clientX, event.clientY);
  logHoverDiag(event.clientX, event.clientY, stackLen, element, extracted);
  if (!element) {
    setHighlight(null);
    if (tooltip) {
      tooltip.style.display = 'block';
      tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 330)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 40)}px`;
      tooltip.textContent = 'Choose a visible usage value';
    }
    return;
  }
  setHighlight(element);
  if (extracted.value != null) {
    lastHoverHit = { x: event.clientX, y: event.clientY, element, extracted };
  }
  if (!tooltip) return;
  tooltip.style.display = 'block';
  tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 330)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 40)}px`;
  tooltip.textContent = extracted.value == null
    ? 'Choose a visible usage value'
    : `${formatExtracted(extracted)} · click to track`;
}

function markSelectGesture(x: number, y: number): void {
  lastSelectAt = Date.now();
  lastSelectX = x;
  lastSelectY = y;
}

function isDuplicateSelectGesture(x: number, y: number): boolean {
  return Date.now() - lastSelectAt < 500
    && Math.abs(x - lastSelectX) < 8
    && Math.abs(y - lastSelectY) < 8;
}

function clearSavingWatch(): void {
  if (savingResetTimer != null) {
    clearTimeout(savingResetTimer);
    savingResetTimer = null;
  }
}

function beginSavingWatch(): void {
  clearSavingWatch();
  // Never leave the picker permanently deaf if a message port stalls.
  savingResetTimer = setTimeout(() => {
    if (!saving) return;
    saving = false;
    setStatusHint('Save is taking too long. Click the value again.');
  }, 4000);
}

function endSaving(): void {
  saving = false;
  clearSavingWatch();
}

/** Stage a metric (or reset anchor) from page coordinates. Shared by pointerdown / pointerup / click. */
function selectAtPoint(clientX: number, clientY: number): void {
  if (!pickerHost || saving || !activeProviderId) {
    obsLog('picker.select.blocked', {
      hasHost: Boolean(pickerHost),
      saving,
      hasProvider: Boolean(activeProviderId),
    });
    return;
  }
  const selectStartedAt = perfNow();
  const element = resolveSelectElement(clientX, clientY);
  if (!element) {
    obsLog('picker.select.miss', { mode: activePickerMode, usedHover: Boolean(lastHoverHit) });
    setStatusHint('Could not hit a page element under the cursor. Try again.');
    return;
  }
  if (activePickerMode === 'reset') {
    if (!initialMetricId || !resetCandidate(element)) {
      setStatusHint('Choose a reset date or countdown text.');
      return;
    }
    saving = true;
    beginSavingWatch();
    markSelectGesture(clientX, clientY);
    obsLog('picker.select.reset', { tag: element.tagName.toLowerCase() });
    void chrome.runtime.sendMessage({ type: 'SAVE_RESET_ANCHOR', providerId: activeProviderId, metricId: initialMetricId, resetAnchor: createAnchorFingerprint(element) })
      .then((response: { saved?: boolean; metrics?: TaughtMetric[] }) => {
        statusHint = null;
        applySavedMetrics(response, savedMetrics);
      })
      .catch(() => { setStatusHint('Could not save reset anchor. Try again.'); renderPanel(); })
      .finally(() => { endSaving(); });
    return;
  }
  obsLog('picker.select.start', {
    tag: element.tagName.toLowerCase(),
    childElementCount: element.childElementCount,
    providerId: activeProviderId,
    usedHoverFallback: lastHoverHit?.element === element,
  });
  const refineStartedAt = perfNow();
  let target = refineValueElement(element);
  let refineMs = perfNow() - refineStartedAt;
  let extracted = extractValue(target);
  // Hover already showed a value: never lose the click because refine walked elsewhere.
  if (extracted.value == null) {
    const direct = extractValue(element);
    if (direct.value != null) {
      target = element;
      extracted = direct;
    } else if (lastHoverHit && lastHoverHit.element === element) {
      extracted = lastHoverHit.extracted;
      target = element;
    }
  }
  if (extracted.value == null) {
    obsLog('picker.select.no-value', {
      tag: element.tagName.toLowerCase(),
      targetTag: target.tagName.toLowerCase(),
      childElementCount: element.childElementCount,
      refineMs: Math.round(refineMs),
    });
    setStatusHint('No usage number found here. Hover until the tooltip shows a value, then click.');
    return;
  }
  saving = true;
  beginSavingWatch();
  markSelectGesture(clientX, clientY);
  try {
    const metricStartedAt = perfNow();
    // target is already refined — makeMetric will re-refine cheaply on a small node.
    const metric = makeMetric(target, initialMetricId);
    const makeMetricMs = perfNow() - metricStartedAt;
    const resetLive = liveResetForElement(target);
    initialMetricId = undefined;
    activePickerMode = 'metrics';
    const fallback = [...savedMetrics.filter((item) => item.metricId !== metric.metricId), metric];
    // Optimistic UI: show the staged metric immediately even if the SW reply is slow.
    statusHint = null;
    applySavedMetrics({ saved: true, metrics: fallback }, fallback);
    obsLog('picker.select.staged', {
      tag: element.tagName.toLowerCase(),
      targetTag: target.tagName.toLowerCase(),
      childElementCount: element.childElementCount,
      refineMs: Math.round(refineMs),
      makeMetricMs: Math.round(makeMetricMs),
      hasResetAt: Boolean(resetLive.resetAt),
      totalMs: Math.round(perfNow() - selectStartedAt),
    });
    const saveStartedAt = perfNow();
    void chrome.runtime.sendMessage({
      type: 'SAVE_METRIC',
      providerId: activeProviderId,
      metric,
      liveRead: {
        value: extracted.value,
        used: extracted.used,
        remaining: extracted.remaining,
        total: extracted.total,
        unit: extracted.unit,
        evidence: extracted.evidence,
        semanticSignals: extracted.semanticSignals,
        resetLabel: resetLive.resetLabel,
        resetAt: resetLive.resetAt,
      },
    })
      .then((response: { saved?: boolean; metrics?: TaughtMetric[] }) => {
        obsLog('picker.select.save-reply', {
          saved: Boolean(response?.saved),
          ms: Math.round(perfNow() - saveStartedAt),
        });
        applySavedMetrics(response, fallback);
      })
      .catch((error: unknown) => {
        obsLog('picker.select.save-fail', {
          ms: Math.round(perfNow() - saveStartedAt),
          error: error instanceof Error ? error.name : 'unknown',
        });
        applySavedMetrics(undefined, fallback);
      })
      .finally(() => { endSaving(); });
  } catch (error) {
    endSaving();
    obsLog('picker.select.exception', {
      error: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    });
    setStatusHint('Could not save this element. Try clicking the number itself.');
  }
}

function shouldIgnoreSelectEvent(event: Event): boolean {
  if (!pickerHost || saving || !activeProviderId || isPanelEvent(event)) return true;
  const stamp = event.timeStamp || Date.now();
  // window + host both listen in capture — handle each physical gesture once.
  if (stamp > 0 && stamp === lastHandledEventStamp) return true;
  lastHandledEventStamp = stamp;
  return false;
}

function onPointerDown(event: PointerEvent): void {
  if (shouldIgnoreSelectEvent(event)) return;
  // Primary path: many SPAs (incl. ChatGPT/Codex) consume pointerdown and never emit click.
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  selectAtPoint(event.clientX, event.clientY);
}

/** Some SPAs swallow pointerdown but still deliver pointerup / click. */
function onPointerUp(event: PointerEvent): void {
  if (!pickerHost || saving || !activeProviderId || isPanelEvent(event)) return;
  if (event.button != null && event.button !== 0) return;
  if (isDuplicateSelectGesture(event.clientX, event.clientY)) return;
  // Only act when pointerdown did not already stage (same coordinates within window).
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const stamp = event.timeStamp || Date.now();
  if (stamp > 0 && stamp === lastHandledEventStamp) return;
  lastHandledEventStamp = stamp;
  selectAtPoint(event.clientX, event.clientY);
}

function onClick(event: MouseEvent): void {
  if (!pickerHost || saving || !activeProviderId || isPanelEvent(event)) return;
  // Fallback when pointerdown did not run (keyboard activation, older engines).
  if (isDuplicateSelectGesture(event.clientX, event.clientY)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const stamp = event.timeStamp || Date.now();
  if (stamp > 0 && stamp === lastHandledEventStamp) return;
  lastHandledEventStamp = stamp;
  selectAtPoint(event.clientX, event.clientY);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  // Prefer cancelling inline rename over discarding the whole teach session.
  if (panel?.querySelector('[data-rename-input]')) {
    renderPanel();
    return;
  }
  void cancelPicker();
}

function clearTopLayerTimers(): void {
  for (const id of topLayerTimers) window.clearTimeout(id);
  topLayerTimers = [];
}

/**
 * Grok usage is a native top-layer dialog. We must also sit in the top layer so the
 * teach panel and orange marker paint above it — but we must NOT use showModal().
 * Modal dialogs mark the rest of the document (including Grok) as inert, so
 * elementFromPoint returns nothing and the orange marker never appears.
 * Popover top-layer stacks above without making the page inert.
 */
function reassertPickerTopLayer(host: HTMLElement, forceRestack = false): void {
  if (pickerHost !== host || !activeProviderId) return;
  try {
    if (typeof host.showPopover === 'function') {
      let open = false;
      try {
        open = typeof host.matches === 'function' && host.matches(':popover-open');
      } catch {
        open = false;
      }
      if (forceRestack && open && typeof host.hidePopover === 'function') {
        host.hidePopover();
      }
      if (!open || forceRestack) {
        host.showPopover();
        obsLog('picker.top-layer', { mode: forceRestack ? 'popover-restack' : 'popover-reopen' });
      }
      return;
    }
    // Non-modal dialog fallback (no inert). Still may sit under Grok's modal.
    if (host instanceof HTMLDialogElement && typeof host.show === 'function' && !host.open) {
      host.show();
      obsLog('picker.top-layer', { mode: 'dialog-show-reopen', open: host.open });
    }
  } catch (error) {
    obsLog('picker.top-layer-fail', { error: error instanceof Error ? error.name : 'unknown' });
  }
}

function promoteToTopLayer(host: HTMLElement): void {
  clearTopLayerTimers();
  pickerDocStyle?.remove();
  pickerDocStyle = document.createElement('style');
  pickerDocStyle.setAttribute('data-many-ai-usage-picker-style', 'true');
  // Popover UA styles add margins/borders — force a full-viewport transparent host.
  pickerDocStyle.textContent = `
    [data-many-ai-usage-picker], dialog[data-many-ai-usage-picker] {
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      background: transparent !important;
      color: inherit !important;
      overflow: visible !important;
      pointer-events: none !important;
      z-index: 2147483647 !important;
    }
    [data-many-ai-usage-picker]::backdrop,
    dialog[data-many-ai-usage-picker]::backdrop {
      display: none !important;
      pointer-events: none !important;
    }
  `;
  document.documentElement.append(pickerDocStyle);

  try {
    if (typeof host.showPopover === 'function') {
      host.setAttribute('popover', 'manual');
      host.showPopover();
      obsLog('picker.top-layer', { mode: 'popover-initial' });
    } else if (host instanceof HTMLDialogElement && typeof host.show === 'function') {
      // Non-modal only — showModal() would inert Grok and kill the orange marker.
      host.show();
      obsLog('picker.top-layer', { mode: 'dialog-show-initial', open: host.open });
    }
  } catch (error) {
    obsLog('picker.top-layer-fail', {
      phase: 'initial',
      error: error instanceof Error ? error.name : 'unknown',
    });
  }

  // Grok may open its sheet after us — reopen (and occasionally restack) without showModal.
  for (const ms of [100, 400, 1200]) {
    topLayerTimers.push(window.setTimeout(() => reassertPickerTopLayer(host, false), ms));
  }
  for (const ms of [600, 2000, 4000]) {
    topLayerTimers.push(window.setTimeout(() => reassertPickerTopLayer(host, true), ms));
  }
  // Keep climbing above Grok's modal while teaching (marker lives in this top layer).
  if (restackIntervalId != null) window.clearInterval(restackIntervalId);
  restackIntervalId = window.setInterval(() => reassertPickerTopLayer(host, true), 1_200);
}

export function stopPicker(): void {
  setHighlight(null);
  clearTopLayerTimers();
  if (restackIntervalId != null) {
    window.clearInterval(restackIntervalId);
    restackIntervalId = null;
  }
  lastHoverDiagAt = 0;
  lastHoverDiagKey = '';
  window.removeEventListener('mousemove', onMove, true);
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('pointerup', onPointerUp, true);
  window.removeEventListener('click', onClick, true);
  window.removeEventListener('keydown', onKeydown, true);
  pickerHost?.removeEventListener('pointerdown', onPointerDown, true);
  pickerHost?.removeEventListener('pointerup', onPointerUp, true);
  pickerHost?.removeEventListener('click', onClick, true);
  clearSavingWatch();
  try {
    let popoverOpen = false;
    try {
      popoverOpen = Boolean(
        pickerHost
        && typeof pickerHost.hidePopover === 'function'
        && typeof pickerHost.matches === 'function'
        && pickerHost.matches(':popover-open'),
      );
    } catch {
      popoverOpen = Boolean(pickerHost && typeof pickerHost.hidePopover === 'function');
    }
    if (popoverOpen && pickerHost) {
      pickerHost.hidePopover();
    } else if (pickerHost instanceof HTMLDialogElement && pickerHost.open) {
      pickerHost.close();
    }
  } catch {
    /* ignore */
  }
  pickerHost?.remove();
  pickerHost = null;
  pickerDocStyle?.remove();
  pickerDocStyle = null;
  pickerShadowRoot = null;
  highlightBox = null;
  tooltip = null;
  panel = null;
  highlighted = null;
  activeProviderId = null;
  initialMetricId = undefined;
  activePickerMode = 'metrics';
  savedMetrics = [];
  saving = false;
  lastSelectAt = 0;
  lastHandledEventStamp = 0;
  lastHoverHit = null;
  statusHint = null;
  document.body.style.cursor = '';
}

export function startPicker(providerId: string, metricId?: string, pickerMode: 'metrics' | 'reset' = 'metrics'): void {
  stopPicker();
  document.querySelectorAll('[data-many-ai-usage-picker]').forEach((node) => node.remove());
  document.querySelectorAll('[data-many-ai-usage-picker-style]').forEach((node) => node.remove());
  activeProviderId = providerId;
  initialMetricId = metricId;
  activePickerMode = pickerMode;
  obsLog('picker.start', {
    providerId,
    pickerMode,
    href: typeof location !== 'undefined' ? `${location.pathname}${location.search}` : '',
  });

  // Shell: popover host (top layer, NOT showModal — modal inert kills hit-testing on Grok).
  // Inner surface: attachShadow target. Host/surface stay pointer-events:none so the page
  // remains hittable; only the panel receives pointer events.
  const shell = document.createElement('div');
  shell.dataset.manyAiUsagePicker = 'true';
  shell.setAttribute('popover', 'manual');
  Object.assign(shell.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    margin: '0',
    padding: '0',
    border: 'none',
    zIndex: '2147483647',
    pointerEvents: 'none',
    background: 'transparent',
    cursor: 'crosshair',
    overflow: 'visible',
    maxWidth: 'none',
    maxHeight: 'none',
  });
  const surface = document.createElement('div');
  Object.assign(surface.style, {
    position: 'fixed',
    inset: '0',
    width: '100%',
    height: '100%',
    margin: '0',
    padding: '0',
    border: 'none',
    background: 'transparent',
    pointerEvents: 'none',
    cursor: 'crosshair',
  });
  shell.append(surface);
  const shadow = surface.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      display: block;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      pointer-events: none !important;
    }
    .highlight-box {
      position: fixed;
      display: none;
      box-sizing: border-box;
      border: 3px solid #f97316;
      border-radius: 8px;
      box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.35), 0 0 12px rgba(249, 115, 22, 0.45);
      background: rgba(249, 115, 22, 0.08);
      pointer-events: none;
      z-index: 1;
    }
    .tooltip { position: fixed; max-width: 320px; padding: 6px 8px; border-radius: 5px; background: #172033; color: white; font: 12px system-ui; pointer-events: none; display: none; white-space: nowrap; z-index: 2; }
    .panel { position: fixed; top: 16px; right: 16px; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px; border: 1px solid #334155; border-radius: 12px; background: #fff; color: #172033; box-shadow: 0 16px 45px rgba(15,23,42,.28); font: 14px/1.4 system-ui; pointer-events: auto; z-index: 3; }
    h2 { margin: 0 0 6px; font-size: 16px; color: #172033; }
    p { margin: 0 0 10px; color: #475569; }
    .count { font-weight: 700; color: #172033; }
    .list { display: grid; gap: 6px; margin: 10px 0; max-height: 240px; overflow: auto; }
    .metric-row { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 6px; align-items: center; padding: 7px; border-radius: 7px; background: #f1f5f9; color: #172033; }
    .metric-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .metric-row input { width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font: inherit; color: #172033; background: #fff; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    button { border: 1px solid #cbd5e1; border-radius: 7px; padding: 6px 9px; background: #fff; color: #172033; cursor: pointer; font: inherit; }
    button.primary { border-color: #ea580c; background: #f97316; color: #fff; } button.primary:disabled { opacity: .5; cursor: not-allowed; }
  `;
  tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `<h2>many-ai-usage teaching</h2><p data-hint>${pickerMode === 'reset' ? 'Click the reset date or countdown for this metric.' : 'Click the big total (e.g. 使用済). Avoid small legend chips.'}</p><div class="count" data-count>Saved: 0</div><div class="list" data-list></div><div class="actions"><button type="button" data-action="cancel">Cancel</button><button type="button" class="primary" data-action="done" disabled>Done and return</button></div>`;
  panel.addEventListener('click', (event) => void panelClick(event));
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const input = (event.target as Element | null)?.closest?.('input[data-rename-input]') as HTMLInputElement | null;
    if (!input?.dataset.metricId) return;
    event.preventDefault();
    event.stopPropagation();
    const renameId = input.dataset.metricId;
    const save = panel?.querySelector<HTMLButtonElement>(`button[data-action="rename-save"][data-metric-id="${cssEscape(renameId)}"]`);
    save?.click();
  });
  // Highlight first in DOM so it sits under tooltip/panel; create eagerly so setHighlight never no-ops.
  highlightBox = document.createElement('div');
  highlightBox.className = 'highlight-box';
  highlightBox.setAttribute('aria-hidden', 'true');
  shadow.append(style, highlightBox, tooltip, panel);
  pickerShadowRoot = shadow;
  pickerHost = shell;
  document.documentElement.append(shell);
  promoteToTopLayer(shell);
  renderPanel();
  document.body.style.cursor = 'crosshair';
  // Window capture: host is pointer-events none, so page events still reach the window.
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeydown, true);
}

export function isPickerActive(): boolean {
  return pickerHost != null;
}
