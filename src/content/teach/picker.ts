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
/** Suppress the trailing `click` after a successful `pointerdown` select (same gesture). */
let lastSelectAt = 0;
let lastSelectX = 0;
let lastSelectY = 0;
let statusHint: string | null = null;
let savingResetTimer: ReturnType<typeof setTimeout> | null = null;

/** Hit-test the page under the full-screen picker host (temporarily disables host pointer events). */
function elementAtPoint(x: number, y: number): Element | null {
  if (!pickerHost) return null;
  const previous = pickerHost.style.pointerEvents;
  pickerHost.style.pointerEvents = 'none';
  const element = document.elementFromPoint(x, y);
  pickerHost.style.pointerEvents = previous;
  if (!element || element === pickerHost || pickerHost.contains(element)) return null;
  return element;
}

function isPanelEvent(event: Event): boolean {
  return panel != null && event.composedPath().includes(panel);
}

function applySavedMetrics(response: { saved?: boolean; metrics?: TaughtMetric[] } | undefined, fallback: TaughtMetric[]): void {
  // Empty arrays are truthy, so never use `response.metrics ?? fallback` — a failed SAVE returns metrics: [].
  savedMetrics = response?.saved && Array.isArray(response.metrics) ? response.metrics : fallback;
  renderPanel();
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

/** Prefer the deepest, most usage-like node (avoids teaching whole flex rows or bare labels like "5h"). */
export function refineValueElement(element: Element): Element {
  const scored = [element, ...Array.from(element.querySelectorAll('*'))]
    .map((node) => ({ node, extracted: extractValue(node) }))
    .filter((item) => item.extracted.value != null)
    .map((item) => {
      const text = item.extracted.evidence.replace(/\s+/g, ' ').trim();
      const rounded = String(Math.round(item.extracted.value!));
      // extractValue may borrow a nearby parent unit/% — prefer nodes that carry the number themselves.
      const ownMentionsValue = text.includes(rounded) || (item.extracted.unit === 'percent' && /%/.test(text));
      let score = 0;
      if (ownMentionsValue) score += 80;
      else score -= 60;
      if (item.extracted.unit === 'percent' || /%/.test(text)) score += 100;
      else if (item.extracted.unit !== 'custom') score += 50;
      if (item.extracted.semanticSignals.includes('used-total')) score += 20;
      if (item.extracted.semanticSignals.includes('remaining') || item.extracted.semanticSignals.includes('used')) score += 10;
      score -= Math.min(text.length, 40);
      return { ...item, score };
    })
    .sort((left, right) => right.score - left.score);
  return scored[0]?.node ?? element;
}

export function makeMetric(element: Element, metricId?: string): TaughtMetric {
  const target = refineValueElement(element);
  const anchor = createAnchorFingerprint(target);
  const extracted = extractValue(target);
  const label = metricLabel(target, anchor.nearbyLabel ?? extracted.evidence);
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
    resetAnchor: inferResetAnchor(target),
    interpretation,
    enabled: true,
  };
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

/** Stage a metric (or reset anchor) from page coordinates. Shared by pointerdown + click. */
function selectAtPoint(clientX: number, clientY: number): void {
  if (!pickerHost || saving || !activeProviderId) return;
  const element = elementAtPoint(clientX, clientY);
  if (!element) {
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
    void chrome.runtime.sendMessage({ type: 'SAVE_RESET_ANCHOR', providerId: activeProviderId, metricId: initialMetricId, resetAnchor: createAnchorFingerprint(element) })
      .then((response: { saved?: boolean; metrics?: TaughtMetric[] }) => {
        statusHint = null;
        applySavedMetrics(response, savedMetrics);
      })
      .catch(() => { setStatusHint('Could not save reset anchor. Try again.'); renderPanel(); })
      .finally(() => { endSaving(); });
    return;
  }
  const target = refineValueElement(element);
  const extracted = extractValue(target);
  if (extracted.value == null) {
    setStatusHint('No usage number found here. Hover until the tooltip shows a value, then click.');
    return;
  }
  saving = true;
  beginSavingWatch();
  markSelectGesture(clientX, clientY);
  const metric = makeMetric(target, initialMetricId);
  initialMetricId = undefined;
  activePickerMode = 'metrics';
  const fallback = [...savedMetrics.filter((item) => item.metricId !== metric.metricId), metric];
  // Optimistic UI: show the staged metric immediately even if the SW reply is slow.
  statusHint = null;
  applySavedMetrics({ saved: true, metrics: fallback }, fallback);
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
    },
  })
    .then((response: { saved?: boolean; metrics?: TaughtMetric[] }) => {
      applySavedMetrics(response, fallback);
    })
    .catch(() => { applySavedMetrics(undefined, fallback); })
    .finally(() => { endSaving(); });
}

function onPointerDown(event: PointerEvent): void {
  if (!pickerHost || saving || !activeProviderId || isPanelEvent(event)) return;
  // Primary path: many SPAs (incl. ChatGPT/Codex) consume pointerdown and never emit click.
  if (event.button != null && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
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

function promoteToTopLayer(host: HTMLElement): void {
  // Site modals (Claude settings) use the browser top layer and sit above z-index: max.
  // Popover/manual puts our teach UI into the same top layer so Done/Rename stay clickable.
  try {
    host.setAttribute('popover', 'manual');
    // Prevent light-dismiss / toggle races if the attribute is ever changed by the host page.
    host.addEventListener('toggle', (event) => {
      const toggle = event as ToggleEvent;
      if (toggle.newState === 'closed' && pickerHost === host && activeProviderId) {
        // Keep teach UI open until the user Cancels/Dones — re-show if something closed it.
        try {
          if (typeof host.showPopover === 'function') host.showPopover();
        } catch {
          /* ignore */
        }
      }
    });
    if (typeof host.showPopover === 'function') host.showPopover();
  } catch {
    /* Unsupported engines keep the fixed + max z-index fallback. */
  }
}

export function stopPicker(): void {
  setHighlight(null);
  window.removeEventListener('mousemove', onMove, true);
  window.removeEventListener('pointerdown', onPointerDown, true);
  window.removeEventListener('click', onClick, true);
  window.removeEventListener('keydown', onKeydown, true);
  pickerHost?.removeEventListener('pointerdown', onPointerDown, true);
  pickerHost?.removeEventListener('click', onClick, true);
  clearSavingWatch();
  try {
    if (pickerHost && typeof pickerHost.hidePopover === 'function' && pickerHost.matches(':popover-open')) {
      pickerHost.hidePopover();
    }
  } catch {
    /* ignore */
  }
  pickerHost?.remove();
  pickerHost = null;
  tooltip = null;
  panel = null;
  activeProviderId = null;
  initialMetricId = undefined;
  activePickerMode = 'metrics';
  savedMetrics = [];
  saving = false;
  lastSelectAt = 0;
  statusHint = null;
  document.body.style.cursor = '';
}

export function startPicker(providerId: string, metricId?: string, pickerMode: 'metrics' | 'reset' = 'metrics'): void {
  stopPicker();
  // Clear hosts left behind by a previous extension context (reload) before attaching a new one.
  document.querySelectorAll('[data-many-ai-usage-picker]').forEach((node) => node.remove());
  activeProviderId = providerId;
  initialMetricId = metricId;
  activePickerMode = pickerMode;
  const host = document.createElement('div');
  host.dataset.manyAiUsagePicker = 'true';
  // Full-screen host captures pointer events so page SPAs cannot swallow teach clicks.
  // elementAtPoint temporarily disables this to hit-test the page underneath.
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    margin: '0',
    padding: '0',
    border: 'none',
    zIndex: '2147483647',
    pointerEvents: 'auto',
    background: 'transparent',
    cursor: 'crosshair',
    overflow: 'visible',
    maxWidth: 'none',
    maxHeight: 'none',
  });
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      background: transparent !important;
      overflow: visible !important;
      max-width: none !important;
      max-height: none !important;
    }
    .tooltip { position: fixed; max-width: 320px; padding: 6px 8px; border-radius: 5px; background: #172033; color: white; font: 12px system-ui; pointer-events: none; display: none; white-space: nowrap; z-index: 2; }
    .panel { position: fixed; top: 16px; right: 16px; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; padding: 16px; border: 1px solid #334155; border-radius: 12px; background: #fff; color: #172033; box-shadow: 0 16px 45px rgba(15,23,42,.28); font: 14px/1.4 system-ui; pointer-events: auto; z-index: 3; }
    h2 { margin: 0 0 6px; font-size: 16px; } p { margin: 0 0 10px; color: #475569; } .count { font-weight: 700; }
    .list { display: grid; gap: 6px; margin: 10px 0; max-height: 240px; overflow: auto; }
    .metric-row { display: grid; grid-template-columns: minmax(0,1fr) auto auto; gap: 6px; align-items: center; padding: 7px; border-radius: 7px; background: #f1f5f9; }
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
  panel.innerHTML = `<h2>many-ai-usage teaching</h2><p data-hint>${pickerMode === 'reset' ? 'Click the reset date or countdown for this metric.' : 'Click each usage number you want to track.'}</p><div class="count" data-count>Saved: 0</div><div class="list" data-list></div><div class="actions"><button type="button" data-action="cancel">Cancel</button><button type="button" class="primary" data-action="done" disabled>Done and return</button></div>`;
  panel.addEventListener('click', (event) => void panelClick(event));
  panel.addEventListener('keydown', (event) => {
    // Keep typing inside rename inputs; only handle Enter to save.
    if (event.key !== 'Enter') return;
    const input = (event.target as Element | null)?.closest?.('input[data-rename-input]') as HTMLInputElement | null;
    if (!input?.dataset.metricId) return;
    event.preventDefault();
    event.stopPropagation();
    const metricId = input.dataset.metricId;
    const save = panel?.querySelector<HTMLButtonElement>(`button[data-action="rename-save"][data-metric-id="${cssEscape(metricId)}"]`);
    save?.click();
  });
  shadow.append(style, tooltip, panel);
  pickerHost = host;
  document.documentElement.append(host);
  promoteToTopLayer(host);
  renderPanel();
  document.body.style.cursor = 'crosshair';
  // Capture on both window and the full-screen host:
  // - window: before most SPA handlers
  // - host: popover top-layer receives the hit; some engines deliver host-target events more reliably there
  // pointerdown is primary (ChatGPT/Codex often swallow click after pointerdown).
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeydown, true);
  host.addEventListener('pointerdown', onPointerDown, true);
  host.addEventListener('click', onClick, true);
}

export function isPickerActive(): boolean {
  return pickerHost != null;
}
