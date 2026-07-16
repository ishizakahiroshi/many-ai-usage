import type { MetricKind, MetricUnit, TaughtMetric } from '../../shared/schema';
import { createAnchorFingerprint, textFingerprint } from './selector';
import { extractValue, type ExtractedValue } from './extract';
import { inferResetAnchor } from './reset';

let pickerHost: HTMLDivElement | null = null;
let tooltip: HTMLDivElement | null = null;
let panel: HTMLDivElement | null = null;
let highlighted: Element | null = null;
let highlightedOutline = '';
let activeProviderId: string | null = null;
let initialMetricId: string | undefined;
let activePickerMode: 'metrics' | 'reset' = 'metrics';
let savedMetrics: TaughtMetric[] = [];
let saving = false;

function elementAtPoint(x: number, y: number): Element | null {
  const element = document.elementFromPoint(x, y);
  return element && pickerHost && element !== pickerHost && !pickerHost.contains(element) ? element : null;
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
  return text.length > 0 && text.length <= 180
    && /(?:\b(?:reset|resets|renew|renews|next\s+window)\b|リセット|更新|次のウィンドウ|下次)/i.test(text)
    && /(\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|(?:in|within)\s+\d+(?:\.\d+)?\s*(?:m|min|minutes?|h|hours?|d|days?)|\d+(?:\.\d+)?\s*(?:分|時間|日)後|tomorrow|明日|明天)/i.test(text);
}

export function makeMetric(element: Element, metricId?: string): TaughtMetric {
  const anchor = createAnchorFingerprint(element);
  const extracted = extractValue(element);
  const label = metricLabel(element, anchor.nearbyLabel ?? extracted.evidence);
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
    resetAnchor: inferResetAnchor(element),
    interpretation,
    enabled: true,
  };
}

function renderPanel(): void {
  if (!panel) return;
  const list = panel.querySelector('[data-list]');
  const count = panel.querySelector('[data-count]');
  if (!list || !count) return;
  count.textContent = `Saved: ${savedMetrics.length}`;
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
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button[data-action]');
  if (!button || !activeProviderId) return;
  const action = button.dataset.action;
  if (action === 'done') return finishPicker();
  if (action === 'cancel') return cancelPicker();
  const metricId = button.dataset.metricId;
  if (!metricId) return;
  if (action === 'remove') {
    const response = await chrome.runtime.sendMessage({ type: 'REMOVE_METRIC', providerId: activeProviderId, metricId }) as { metrics?: TaughtMetric[] };
    savedMetrics = response.metrics ?? savedMetrics.filter((metric) => metric.metricId !== metricId);
    renderPanel();
  }
  if (action === 'rename') {
    const current = savedMetrics.find((metric) => metric.metricId === metricId);
    const label = window.prompt('Metric name', current?.label ?? '')?.trim();
    if (!label) return;
    const response = await chrome.runtime.sendMessage({ type: 'RENAME_METRIC', providerId: activeProviderId, metricId, label }) as { metrics?: TaughtMetric[] };
    savedMetrics = response.metrics ?? savedMetrics.map((metric) => metric.metricId === metricId ? { ...metric, label, windowLabel: label } : metric);
    renderPanel();
  }
}

function onMove(event: MouseEvent): void {
  const element = elementAtPoint(event.clientX, event.clientY);
  setHighlight(element);
  if (!tooltip) return;
  tooltip.style.display = 'block';
  tooltip.style.left = `${Math.min(event.clientX + 12, window.innerWidth - 330)}px`;
  tooltip.style.top = `${Math.min(event.clientY + 12, window.innerHeight - 40)}px`;
  if (activePickerMode === 'reset') {
    tooltip.textContent = element && resetCandidate(element) ? `${(element.textContent ?? '').replace(/\s+/g, ' ').trim()} · click to use reset` : 'Choose a reset date or countdown';
  } else {
    const extracted = element ? extractValue(element) : null;
    tooltip.textContent = extracted?.value == null ? 'Choose a visible usage value' : `${formatExtracted(extracted)} · click to track`;
  }
}

function onClick(event: MouseEvent): void {
  if (!pickerHost || event.composedPath().includes(pickerHost) || saving || !activeProviderId) return;
  const element = elementAtPoint(event.clientX, event.clientY);
  if (!element) return;
  if (activePickerMode === 'reset') {
    if (!initialMetricId || !resetCandidate(element)) return;
    event.preventDefault();
    event.stopPropagation();
    saving = true;
    void chrome.runtime.sendMessage({ type: 'SAVE_RESET_ANCHOR', providerId: activeProviderId, metricId: initialMetricId, resetAnchor: createAnchorFingerprint(element) })
      .then((response: { metrics?: TaughtMetric[] }) => {
        savedMetrics = response.metrics ?? savedMetrics;
        renderPanel();
      })
      .finally(() => { saving = false; });
    return;
  }
  if (extractValue(element).value == null) return;
  event.preventDefault();
  event.stopPropagation();
  saving = true;
  const metric = makeMetric(element, initialMetricId);
  initialMetricId = undefined;
  activePickerMode = 'metrics';
  void chrome.runtime.sendMessage({ type: 'SAVE_METRIC', providerId: activeProviderId, metric })
    .then((response: { metrics?: TaughtMetric[] }) => {
      savedMetrics = response.metrics ?? [...savedMetrics.filter((item) => item.metricId !== metric.metricId), metric];
      renderPanel();
    })
    .finally(() => { saving = false; });
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  void cancelPicker();
}

export function stopPicker(): void {
  setHighlight(null);
  document.removeEventListener('mousemove', onMove, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('keydown', onKeydown, true);
  pickerHost?.remove();
  pickerHost = null;
  tooltip = null;
  panel = null;
  activeProviderId = null;
  initialMetricId = undefined;
  activePickerMode = 'metrics';
  savedMetrics = [];
  saving = false;
  document.body.style.cursor = '';
}

export function startPicker(providerId: string, metricId?: string, pickerMode: 'metrics' | 'reset' = 'metrics'): void {
  stopPicker();
  activeProviderId = providerId;
  initialMetricId = metricId;
  activePickerMode = pickerMode;
  const host = document.createElement('div');
  host.dataset.manyAiUsagePicker = 'true';
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .tooltip { position: fixed; max-width: 320px; padding: 6px 8px; border-radius: 5px; background: #172033; color: white; font: 12px system-ui; pointer-events: none; display: none; white-space: nowrap; }
    .panel { position: fixed; top: 16px; right: 16px; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px; border: 1px solid #334155; border-radius: 12px; background: #fff; color: #172033; box-shadow: 0 16px 45px rgba(15,23,42,.28); font: 14px/1.4 system-ui; pointer-events: auto; }
    h2 { margin: 0 0 6px; font-size: 16px; } p { margin: 0 0 10px; color: #475569; } .count { font-weight: 700; }
    .list { display: grid; gap: 6px; margin: 10px 0; max-height: 240px; overflow: auto; }
    .metric-row { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 6px; align-items: center; padding: 7px; border-radius: 7px; background: #f1f5f9; }
    .metric-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    button { border: 1px solid #cbd5e1; border-radius: 7px; padding: 6px 9px; background: #fff; color: #172033; cursor: pointer; font: inherit; }
    button.primary { border-color: #ea580c; background: #f97316; color: #fff; } button.primary:disabled { opacity: .5; }
  `;
  tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `<h2>many-ai-usage teaching</h2><p>${pickerMode === 'reset' ? 'Click the reset date or countdown for this metric.' : 'Click each usage number you want to track.'}</p><div class="count" data-count>Saved: 0</div><div class="list" data-list></div><div class="actions"><button type="button" data-action="cancel">Cancel</button><button type="button" class="primary" data-action="done">Done and return</button></div>`;
  panel.addEventListener('click', (event) => void panelClick(event));
  shadow.append(style, tooltip, panel);
  pickerHost = host;
  document.documentElement.append(host);
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);
}

export function isPickerActive(): boolean {
  return pickerHost != null;
}
