import { inferWindowLabel, remainingWords, semanticSignals, usedWords } from './i18n/labels';

export function visibleText(element: Element): string {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return '';
  const style = element.getAttribute('style') ?? '';
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return '';
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Full-width digits and signs, as written on Japanese/Chinese pages ("８０％", "１２／５０").
 * Every detector matches on ASCII patterns, so without this the whole reading is dropped in
 * silence rather than misread.
 */
export function toHalfWidth(value: string): string {
  return value.replace(/[０-９．，％／]/g, (char) => {
    if (char === '．') return '.';
    if (char === '，') return ',';
    if (char === '％') return '%';
    if (char === '／') return '/';
    return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
  });
}

export function nearbyContext(element: Element): string {
  const own = visibleText(element);
  const parent = element.parentElement ? visibleText(element.parentElement) : '';
  const context = toHalfWidth([own, parent].filter(Boolean).join(' — '));
  return context.slice(0, 360);
}

/**
 * Which polarity a number carries when both vocabularies appear in one context.
 *
 * A card headed 週間利用上限 ("weekly usage limit") reading 「53% 残り」 matches both 利用 and
 * 残り, so a flat boolean pair marks the same number as used *and* remaining. The word sitting
 * closest to the number is the one describing it; a distant heading only sets the topic.
 */
export function nearestPolarity(context: string, matchStart: number, matchLength: number): 'used' | 'remaining' | null {
  const distance = (pattern: RegExp): number | null => {
    let best: number | null = null;
    const global = new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, '')}g`);
    for (const found of context.matchAll(global)) {
      const index = found.index ?? 0;
      const gap = index >= matchStart + matchLength
        ? index - (matchStart + matchLength)
        : Math.max(0, matchStart - (index + found[0].length));
      if (best == null || gap < best) best = gap;
    }
    return best;
  };
  const used = distance(usedWords);
  const remaining = distance(remainingWords);
  if (used == null && remaining == null) return null;
  if (used == null) return 'remaining';
  if (remaining == null) return 'used';
  return remaining < used ? 'remaining' : 'used';
}

export function allElements(document: Document): Element[] {
  const result: Element[] = [];
  const visit = (root: Document | ShadowRoot | Element) => {
    for (const child of Array.from(root.children)) {
      result.push(child);
      const shadow = child.shadowRoot;
      if (shadow) visit(shadow);
      visit(child);
    }
  };
  visit(document);
  return result;
}


export function numberValue(value: string | null | undefined): number | null {
  if (value == null) return null;
  const normalized = toHalfWidth(value).replace(/,/g, '').trim();
  // Number('') and Number('   ') are 0, which would turn a missing aria-valuenow into a real
  // reading and stop the caller's ?? fallback chain from ever running.
  if (normalized === '') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isLikelyYear(value: number | null, raw: string): boolean {
  return value != null && /^\d{4}$/.test(raw.replace(/,/g, '')) && value >= 1900 && value <= 2100;
}

export function isResetDateMatch(context: string, start: number, raw: string): boolean {
  const nearby = context.slice(Math.max(0, start - 40), start + raw.length + 20);
  return /(?:\b(?:reset|resets|renew|renews)\b|リセット|更新|下次)/i.test(nearby)
    && /\d{4}[\/.\-]\d{1,2}(?:[\/.\-]\d{1,2})?/.test(nearby);
}

export function contextMeta(context: string) {
  return {
    label: context.slice(0, 120) || null,
    windowLabel: inferWindowLabel(context),
    semanticSignals: semanticSignals(context),
  };
}

export function toId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9一-龠ぁ-んァ-ン]+/g, '-').replace(/^-|-$/g, '');
  return normalized.slice(0, 42) || 'current';
}
