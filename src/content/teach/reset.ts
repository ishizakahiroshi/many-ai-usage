import type { AnchorFingerprint } from '../../shared/schema';
import { createAnchorFingerprint } from './selector';

const RESET_WORDS = /(\b(?:reset|resets|renew|renews|next\s+window)\b|リセット|更新|次のウィンドウ|下次)/i;
/** Slash/ISO dates, relative countdowns, and Grok-style「2026年7月24日 9:15」. */
const RESET_VALUE = /(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|(?:in|within)\s+\d+(?:\.\d+)?\s*(?:m|min|minutes?|h|hours?|d|days?)|\d+(?:\.\d+)?\s*(?:分|時間|日)後|tomorrow|明日|明天)/i;

function compactText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Direct text nodes only — safe on large SPA shells. */
function ownDirectText(element: Element): string {
  let text = '';
  for (const child of element.childNodes) {
    if (child.nodeType !== Node.TEXT_NODE) continue;
    text += child.textContent ?? '';
    if (text.length > 200) break;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Compact label text without walking a huge subtree's textContent.
 * Full textContent is only used for small nodes (reset chips are short).
 */
function compactLabelText(element: Element): string {
  if (element.childElementCount > 12) return ownDirectText(element);
  let nested = 0;
  for (const child of element.children) {
    nested += child.childElementCount;
    if (nested > 32) return ownDirectText(element);
  }
  return compactText(element);
}

const RESET_SCAN_BUDGET = 80;
const RESET_HUGE_CHILD = 200;

export function parseResetText(text: string, now = Date.now()): string | null {
  // Grok usage sheet:「2026年7月24日 9:15 にリセット」
  const japanese = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{2}))?/);
  if (japanese) {
    const value = new Date(
      Number(japanese[1]),
      Number(japanese[2]) - 1,
      Number(japanese[3]),
      Number(japanese[4] ?? 0),
      Number(japanese[5] ?? 0),
    );
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const absolute = text.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[ T](\d{1,2}):?(\d{2})?)?/);
  if (absolute) {
    const value = new Date(
      Number(absolute[1]),
      Number(absolute[2]) - 1,
      Number(absolute[3]),
      Number(absolute[4] ?? 0),
      Number(absolute[5] ?? 0),
    );
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const relative = text.match(/(?:in|within)\s+(\d+(?:\.\d+)?)\s*(m|min|minutes?|h|hours?|d|days?)/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*(分|時間|日)後/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const multiplier = /^(?:m|min|minute|minutes|分)$/.test(unit)
      ? 60_000
      : /^(?:h|hour|hours|時間)$/.test(unit)
        ? 60 * 60_000
        : 24 * 60 * 60_000;
    return new Date(now + amount * multiplier).toISOString();
  }
  if (/tomorrow|明日|明天/i.test(text)) return new Date(now + 24 * 60 * 60_000).toISOString();
  return null;
}

export function isResetLabelText(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 0
    && compact.length <= 180
    && RESET_WORDS.test(compact)
    && RESET_VALUE.test(compact);
}

function collectResetCandidates(scope: Element, exclude: Element, budget: number): Element[] {
  const out: Element[] = [];
  const push = (el: Element): void => {
    if (el !== exclude && out.length < budget) out.push(el);
  };
  const visit = (el: Element, depth: number): void => {
    if (out.length >= budget) return;
    push(el);

    const kidCount = el.children.length;
    const kids: Element[] = [];
    for (let i = 0; i < kidCount; i += 1) kids.push(el.children[i]!);
    kids.sort((left, right) => left.childElementCount - right.childElementCount);
    for (const kid of kids) {
      if (out.length >= budget) return;
      if (kid === exclude) continue;
      if (kid.childElementCount > RESET_HUGE_CHILD) {
        // Shallow only under chat-sized trees (no Array.from on huge lists).
        push(kid);
        const limit = Math.min(kid.children.length, 24);
        for (let i = 0; i < limit; i += 1) {
          push(kid.children[i]!);
          if (out.length >= budget) return;
        }
        continue;
      }
      if (depth >= 10) {
        push(kid);
        continue;
      }
      visit(kid, depth + 1);
    }
  };
  visit(scope, 0);
  return out;
}

/** Closest compact reset label element (Grok:「…にリセット」next to the SuperGrok card). */
export function findResetElement(element: Element): Element | null {
  let scope: Element | null = element.parentElement;
  for (let depth = 0; scope && depth < 6; depth += 1, scope = scope.parentElement) {
    if (scope === document.body || scope === document.documentElement) break;
    const candidates = collectResetCandidates(scope, element, RESET_SCAN_BUDGET)
      .filter((candidate) => isResetLabelText(compactLabelText(candidate)))
      .sort((left, right) => compactLabelText(left).length - compactLabelText(right).length);
    if (candidates[0]) return candidates[0];
  }
  return null;
}

/** Find the closest compact reset label without treating a whole page/card as one anchor. */
export function inferResetAnchor(element: Element): AnchorFingerprint | undefined {
  const found = findResetElement(element);
  return found ? createAnchorFingerprint(found) : undefined;
}

/** Label + ISO time when a nearby reset node can be parsed (used for teach-time live snapshot). */
export function inferResetLive(element: Element, now = Date.now()): { resetAnchor?: AnchorFingerprint; resetLabel: string | null; resetAt: string | null } {
  const found = findResetElement(element);
  if (!found) return { resetLabel: null, resetAt: null };
  const resetLabel = compactLabelText(found).slice(0, 180) || null;
  return {
    resetAnchor: createAnchorFingerprint(found),
    resetLabel,
    resetAt: resetLabel ? parseResetText(resetLabel, now) : null,
  };
}
