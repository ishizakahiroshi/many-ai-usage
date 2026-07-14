import { inferWindowLabel, semanticSignals } from './i18n/labels';

export function visibleText(element: Element): string {
  if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return '';
  const style = element.getAttribute('style') ?? '';
  if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) return '';
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function nearbyContext(element: Element): string {
  const own = visibleText(element);
  const parent = element.parentElement ? visibleText(element.parentElement) : '';
  const context = [own, parent].filter(Boolean).join(' — ');
  return context.slice(0, 360);
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
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
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
