import {
  accountAnchorSelectorPattern,
  ACCOUNT_ANCHOR_SELECTOR_MAX_LENGTH,
  type AccountAnchor,
} from '../../shared/schema';

const MAX_ACCOUNT_TEXT = 200;
const MAX_ACCOUNT_ANCHOR_DEPTH = 32;

/**
 * Build a locator without copying any page-controlled text or attribute value into storage.
 * A full numeric path is less resilient than a metric fingerprint, but it fails closed when a
 * page changes instead of persisting an email address from id/class/aria-label.
 */
export function createAccountAnchor(element: Element, root: Document = element.ownerDocument): AccountAnchor {
  const positions: number[] = [];
  let current: Element | null = element;
  while (current && current !== root.documentElement && positions.length < MAX_ACCOUNT_ANCHOR_DEPTH) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    const position = Array.prototype.indexOf.call(parent.children, current) + 1;
    if (position <= 0 || position > 9_999) break;
    positions.unshift(position);
    current = parent;
  }
  if (current !== root.documentElement || positions.length === 0) {
    throw new Error('Account element is outside the supported document structure');
  }
  const selector = `:root${positions.map((position) => ` > :nth-child(${position})`).join('')}`;
  if (selector.length > ACCOUNT_ANCHOR_SELECTOR_MAX_LENGTH || !accountAnchorSelectorPattern.test(selector)) {
    throw new Error('Account element is too deeply nested to store safely');
  }
  return { selector };
}

export function resolveAccountAnchor(document: Document, anchor: AccountAnchor): Element | null {
  if (!accountAnchorSelectorPattern.test(anchor.selector)) return null;
  try {
    return document.querySelector(anchor.selector);
  } catch {
    return null;
  }
}

/** Return identity text only for the immediate hash request; callers must never persist or log it. */
export function readAccountAnchorText(document: Document, anchor: AccountAnchor): string | null {
  const element = resolveAccountAnchor(document, anchor);
  const text = element?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text.slice(0, MAX_ACCOUNT_TEXT) : null;
}
