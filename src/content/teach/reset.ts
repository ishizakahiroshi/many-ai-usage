import type { AnchorFingerprint } from '../../shared/schema';
import { createAnchorFingerprint } from './selector';

const RESET_WORDS = /(\b(?:reset|resets|renew|renews|next\s+window)\b|リセット|更新|次のウィンドウ|下次)/i;
const RESET_VALUE = /(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|(?:in|within)\s+\d+(?:\.\d+)?\s*(?:m|min|minutes?|h|hours?|d|days?)|\d+(?:\.\d+)?\s*(?:分|時間|日)後|tomorrow|明日|明天)/i;

function compactText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function parseResetText(text: string, now = Date.now()): string | null {
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

/** Find the closest compact reset label without treating a whole page/card as one anchor. */
export function inferResetAnchor(element: Element): AnchorFingerprint | undefined {
  let scope: Element | null = element.parentElement;
  for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
    const candidates = [scope, ...Array.from(scope.querySelectorAll('*'))]
      .filter((candidate) => candidate !== element)
      .filter((candidate) => {
        const text = compactText(candidate);
        return text.length > 0 && text.length <= 180 && RESET_WORDS.test(text) && RESET_VALUE.test(text);
      })
      .sort((left, right) => compactText(left).length - compactText(right).length);
    if (candidates[0]) return createAnchorFingerprint(candidates[0]);
  }
  return undefined;
}
