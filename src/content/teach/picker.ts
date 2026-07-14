import type { MetricKind, MetricUnit, TaughtMetric } from '../../shared/schema';
import { createAnchorFingerprint, textFingerprint } from './selector';
import { extractValue } from './extract';

let pickerRoot: HTMLDivElement | null = null;
let highlighted: Element | null = null;
let highlightedOutline = '';

function elementAtPoint(x: number, y: number): Element | null {
  if (!pickerRoot) return null;
  pickerRoot.style.pointerEvents = 'none';
  const element = document.elementFromPoint(x, y);
  pickerRoot.style.pointerEvents = 'auto';
  return element && element !== pickerRoot && !pickerRoot.contains(element) ? element : null;
}

function setHighlight(element: Element | null): void {
  if (highlighted && highlighted instanceof HTMLElement) highlighted.style.outline = highlightedOutline;
  highlighted = element;
  if (element instanceof HTMLElement) {
    highlightedOutline = element.style.outline;
    element.style.outline = '3px solid #f97316';
  }
}

function unitKind(unit: MetricUnit): MetricKind {
  if (unit === 'percent') return 'percent';
  if (['requests', 'credits', 'tokens', 'sessions'].includes(unit)) return 'count';
  return 'amount';
}

function makeMetric(element: Element, metricId?: string): TaughtMetric {
  const anchor = createAnchorFingerprint(element);
  const extracted = extractValue(element);
  const parentLabel = element.parentElement?.textContent?.replace(/\b-?\d+(?:[,.]\d+)?\s*%?/g, '').replace(/\s+/g, ' ').trim();
  const label = (element.getAttribute('aria-label') || parentLabel || anchor.nearbyLabel?.replace(/\b-?\d+(?:[,.]\d+)?\s*%?/g, '').trim() || extracted.evidence || 'Taught metric').replace(/\s+/g, ' ').trim().slice(0, 80);
  const unit = extracted.unit;
  const interpretation = extracted.semanticSignals.includes('used')
    ? (unit === 'percent' ? 'used_percent' : 'used_total')
    : extracted.semanticSignals.includes('remaining') || unit === 'percent'
      ? (unit === 'percent' ? 'remaining_percent' : 'remaining_total')
      : 'absolute_value';
  return {
    metricId: metricId ?? `taught-${textFingerprint(`${label}:${anchor.selectors[0] ?? ''}`)}`,
    label,
    kind: unitKind(unit),
    unit,
    windowLabel: label,
    valueAnchor: anchor,
    interpretation,
    enabled: true,
  };
}

export function stopPicker(): void {
  setHighlight(null);
  pickerRoot?.remove();
  pickerRoot = null;
  document.body.style.cursor = '';
}

export function startPicker(providerId: string, metricId?: string): void {
  stopPicker();
  const root = document.createElement('div');
  root.dataset.manyAiUsagePicker = 'true';
  Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: '2147483647', cursor: 'crosshair', background: 'transparent', pointerEvents: 'auto' });
  const tooltip = document.createElement('div');
  Object.assign(tooltip.style, { position: 'fixed', maxWidth: '300px', padding: '6px 8px', borderRadius: '5px', background: '#172033', color: 'white', font: '12px system-ui', pointerEvents: 'none', display: 'none', whiteSpace: 'nowrap' });
  tooltip.textContent = 'Choose a visible usage value · Esc to cancel';
  root.append(tooltip);
  pickerRoot = root;
  document.documentElement.append(root);
  const move = (event: MouseEvent) => {
    const element = elementAtPoint(event.clientX, event.clientY);
    setHighlight(element);
    tooltip.style.display = 'block';
    tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 310)}px`;
    tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 40)}px`;
    if (element) {
      const extracted = extractValue(element);
      tooltip.textContent = extracted.value == null ? 'Choose a visible usage value' : `${extracted.value}${extracted.unit === 'percent' ? '%' : ` ${extracted.unit}`} · click to track`;
    }
  };
  const click = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const element = elementAtPoint(event.clientX, event.clientY);
    if (!element || extractValue(element).value == null) return;
    const metric = makeMetric(element, metricId);
    stopPicker();
    void chrome.runtime.sendMessage({ type: 'SAVE_TAUGHT_METRIC', providerId, metric });
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      stopPicker();
    }
  };
  root.addEventListener('mousemove', move);
  root.addEventListener('click', click, true);
  root.addEventListener('keydown', keydown, true);
  root.tabIndex = 0;
  root.focus();
}

export function isPickerActive(): boolean {
  return pickerRoot != null;
}
