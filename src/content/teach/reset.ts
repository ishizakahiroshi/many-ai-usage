import type { AnchorFingerprint } from '../../shared/schema';
import { createAnchorFingerprint } from './selector';

const RESET_WORDS = /(\b(?:reset|resets|renew|renews|next\s+window)\b|リセット|次回\s*更新|更新\s*(?:まで|後|予定)|(?:に|で)\s*更新(?:され(?:る|ます)?)?|次のウィンドウ|下次)/i;
const NON_RESET_UPDATE = /(\b(?:last\s+updated|last\s+update|updated\s+at)\b|最終\s*更新|(?:^|[\s(（])更新日時?\s*[:：])/i;
/** Slash/ISO dates, relative countdowns, and Grok-style「2026年7月24日 9:15」. */
const RESET_VALUE = /(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|(?:in|within)\s+\d+(?:\.\d+)?\s*(?:months?|mos?|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b|\d+(?:\.\d+)?\s*(?:(?:か|ヶ|箇)?月|分|時間|日)\s*(?:後|まで)|(?:リセット|更新)\s*まで\s*\d+(?:\.\d+)?\s*(?:(?:か|ヶ|箇)?月|分|時間|日)|tomorrow|明日|明天)/i;

const MAX_PAST_RESET_MS = 5 * 60_000;

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

function hasResetIntent(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  return !NON_RESET_UPDATE.test(compact) && RESET_WORDS.test(compact);
}

function validDateParts(year: number, month: number, day: number, hour: number, minute: number, second: number): boolean {
  if (year < 1000 || year > 9999) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > new Date(year, month, 0).getDate()) return false;
  return hour >= 0 && hour <= 23
    && minute >= 0 && minute <= 59
    && second >= 0 && second <= 59;
}

function localDate(year: number, month: number, day: number, hour: number, minute: number, second = 0, millisecond = 0): Date | null {
  if (!validDateParts(year, month, day, hour, minute, second) || millisecond < 0 || millisecond > 999) return null;
  const value = new Date(year, month - 1, day, hour, minute, second, millisecond);
  return value.getFullYear() === year
    && value.getMonth() === month - 1
    && value.getDate() === day
    && value.getHours() === hour
    && value.getMinutes() === minute
    && value.getSeconds() === second
    && value.getMilliseconds() === millisecond
    ? value
    : null;
}

function timezoneDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
  suffix: string,
): Date | null {
  if (!validDateParts(year, month, day, hour, minute, second) || millisecond < 0 || millisecond > 999) return null;
  let normalizedSuffix = suffix.toUpperCase();
  if (normalizedSuffix !== 'Z') {
    const offset = normalizedSuffix.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!offset) return null;
    const offsetHour = Number(offset[2]);
    const offsetMinute = Number(offset[3]);
    // ISO 8601 offsets do not exceed 14:00.
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
    normalizedSuffix = `${offset[1]}${offset[2]}:${offset[3]}`;
  }
  const pad = (part: number): string => String(part).padStart(2, '0');
  const timestamp = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${String(millisecond).padStart(3, '0')}${normalizedSuffix}`;
  const millis = Date.parse(timestamp);
  return Number.isFinite(millis) ? new Date(millis) : null;
}

function plausibleResetIso(value: Date | null, now: number): string | null {
  if (!value || Number.isNaN(value.getTime()) || value.getTime() < now - MAX_PAST_RESET_MS) return null;
  return value.toISOString();
}

/** Calendar-month semantics, clamped to the target month's final day (Jan 31 + 1 month = Feb 28/29). */
function addCalendarMonths(now: number, amount: number): Date | null {
  if (!Number.isInteger(amount) || amount < 0) return null;
  const value = new Date(now);
  if (Number.isNaN(value.getTime())) return null;
  const originalDay = value.getDate();
  value.setDate(1);
  value.setMonth(value.getMonth() + amount);
  const finalDay = new Date(value.getFullYear(), value.getMonth() + 1, 0).getDate();
  value.setDate(Math.min(originalDay, finalDay));
  return value;
}

export function parseResetText(text: string, now = Date.now()): string | null {
  if (!hasResetIntent(text)) return null;
  // Grok usage sheet:「2026年7月24日 9:15 にリセット」
  const japanese = text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*([zZ]|[+-]\d{2}:?\d{2}))?)?/);
  if (japanese) {
    const matchEnd = (japanese.index ?? 0) + japanese[0].length;
    if (/^\s*(?:[zZ]|[+-]|\d)/.test(text.slice(matchEnd))) return null;
    const year = Number(japanese[1]);
    const month = Number(japanese[2]);
    const day = Number(japanese[3]);
    const hour = Number(japanese[4] ?? 0);
    const minute = Number(japanese[5] ?? 0);
    const suffix = japanese[6];
    return plausibleResetIso(
      suffix
        ? timezoneDate(year, month, day, hour, minute, 0, 0, suffix)
        : localDate(year, month, day, hour, minute),
      now,
    );
  }
  const absolute = text.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})(?:[ T](\d{1,2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?(?:\s*([zZ]|[+-]\d{2}:?\d{2}))?)?/);
  if (absolute) {
    const matchEnd = (absolute.index ?? 0) + absolute[0].length;
    // Do not silently parse a local prefix when an unsupported/invalid timezone suffix follows.
    if (/^\s*(?:[zZ]|[+-]|\d)/.test(text.slice(matchEnd))) return null;
    const year = Number(absolute[1]);
    const month = Number(absolute[2]);
    const day = Number(absolute[3]);
    const hour = Number(absolute[4] ?? 0);
    const minute = Number(absolute[5] ?? 0);
    const second = Number(absolute[6] ?? 0);
    const millisecond = Number((absolute[7] ?? '0').padEnd(3, '0'));
    const suffix = absolute[8];
    const value = suffix
      ? timezoneDate(year, month, day, hour, minute, second, millisecond, suffix)
      : localDate(year, month, day, hour, minute, second, millisecond);
    return plausibleResetIso(value, now);
  }
  const relative = text.match(/(?:in|within)\s+(\d+(?:\.\d+)?)\s*(months?|mos?|minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/i)
    ?? text.match(/(\d+(?:\.\d+)?)\s*((?:か|ヶ|箇)?月|分|時間|日)\s*後/i)
    ?? text.match(/(?:リセット|更新)\s*まで\s*(\d+(?:\.\d+)?)\s*((?:か|ヶ|箇)?月|分|時間|日)/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    if (/^(?:months?|mos?|(?:か|ヶ|箇)?月)$/.test(unit)) {
      return plausibleResetIso(addCalendarMonths(now, amount), now);
    }
    const multiplier = /^(?:m|mins?|minutes?|分)$/.test(unit)
      ? 60_000
      : /^(?:h|hrs?|hours?|時間)$/.test(unit)
        ? 60 * 60_000
        : 24 * 60 * 60_000;
    return plausibleResetIso(new Date(now + amount * multiplier), now);
  }
  if (/tomorrow|明日|明天/i.test(text)) return plausibleResetIso(new Date(now + 24 * 60 * 60_000), now);
  return null;
}

export function isResetLabelText(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > 0
    && compact.length <= 180
    && hasResetIntent(compact)
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
