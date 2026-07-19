import type { ProviderContext } from '../shared/messages';
import type { NormalizedSnapshot } from '../shared/schema';
import { diagLog, perfLog, perfNow } from '../shared/perf';
import { sendMessage } from '../shared/runtime';
import { readTaught } from './teach/read';
import { isPickerActive, startPicker } from './teach/picker';

let lastCapturedUrl: string | null = null;
let captureInFlight = false;
let captureQueued = false;

function urlKey(): string {
  const url = new URL(location.href);
  url.hash = '';
  return url.toString();
}

function pageOnlySnapshot(context: ProviderContext): NormalizedSnapshot {
  return {
    providerId: context.provider.id,
    displayName: context.provider.displayName,
    capturedAt: new Date().toISOString(),
    source: 'page_only',
    status: 'ok',
    metrics: [],
    warningReason: 'This provider is configured as a page tile.',
    lastFailureReason: null,
  };
}

async function waitForHydration(): Promise<void> {
  const startedAt = perfNow();
  if (document.readyState === 'loading') {
    await new Promise<void>((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
  }
  await new Promise<void>((resolve) => {
    let quietTimer = window.setTimeout(done, 500);
    const maxTimer = window.setTimeout(done, 5000);
    const observer = new MutationObserver(() => {
      window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(done, 500);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    function done() {
      window.clearTimeout(quietTimer);
      window.clearTimeout(maxTimer);
      observer.disconnect();
      resolve();
    }
  });
  perfLog('content.waitForHydration', startedAt, { href: location.href }, 100);
}

async function capture(force = false): Promise<void> {
  if (captureInFlight) {
    if (force) captureQueued = true;
    return;
  }
  const key = urlKey();
  if (!force && lastCapturedUrl === key) return;
  captureInFlight = true;
  const startedAt = perfNow();
  try {
    const context = await sendMessage<ProviderContext | null>({ type: 'GET_PROVIDER_CONTEXT', url: location.href });
    if (!context?.permissionGranted) {
      diagLog('content.capture.skip', { reason: 'no-context-or-permission', href: location.href });
      return;
    }
    diagLog('content.capture.start', {
      force,
      mode: context.provider.mode,
      providerId: context.provider.id,
      taughtCount: context.provider.metrics.filter((m) => m.enabled && m.valueAnchor).length,
      href: `${location.pathname}${location.search}`,
    });
    await waitForHydration();
    const readStartedAt = perfNow();
    let snapshot = context.provider.mode === 'embed'
      ? pageOnlySnapshot(context)
      : context.provider.mode === 'taught'
        ? readTaught(document, context.provider)
        : {
          ...pageOnlySnapshot(context),
          warningReason: 'Auto detection is preview-only. Track the exact usage element to show a metric.',
        };
    // Grok-style usage sheets mount after first paint — retry while taught metrics stay empty.
    if (
      context.provider.mode === 'taught'
      && snapshot.metrics.length === 0
      && context.provider.metrics.some((metric) => metric.enabled && metric.valueAnchor)
    ) {
      for (const waitMs of [800, 1_500, 2_500]) {
        diagLog('content.capture.retry', {
          providerId: context.provider.id,
          waitMs,
          previousStatus: snapshot.status,
        });
        await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
        snapshot = readTaught(document, context.provider);
        if (snapshot.metrics.length > 0) break;
      }
    }
    perfLog('content.readSnapshot', readStartedAt, { mode: context.provider.mode, providerId: context.provider.id, metrics: snapshot.metrics.length }, 20);
    diagLog('content.capture.result', {
      providerId: context.provider.id,
      status: snapshot.status,
      metrics: snapshot.metrics.length,
      warning: Boolean(snapshot.warningReason),
    });
    await sendMessage({ type: 'CAPTURE_RESULT', providerId: context.provider.id, snapshot });
    lastCapturedUrl = key;
  } catch (error) {
    diagLog('content.capture.error', { name: error instanceof Error ? error.name : 'unknown' });
    const provider = await sendMessage<ProviderContext | null>({ type: 'GET_PROVIDER_CONTEXT', url: location.href }).catch(() => null);
    if (provider) {
      await sendMessage({ type: 'CAPTURE_FAILURE', providerId: provider.provider.id, reason: error instanceof Error ? error.message : 'capture failed' });
    }
  } finally {
    perfLog('content.capture', startedAt, { force, href: location.href }, 50);
    captureInFlight = false;
    if (captureQueued) {
      captureQueued = false;
      void capture(true);
    }
  }
}

function removeOrphanPickers(): void {
  // Never strip a live picker owned by this content-script isolate.
  if (isPickerActive()) return;
  // Extension reload invalidates content-script JS but can leave a dead full-screen host in the DOM.
  document.querySelectorAll('[data-many-ai-usage-picker]').forEach((node) => node.remove());
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true, pickerActive: isPickerActive() });
    return false;
  }
  if (message.type === 'START_PICKER' && 'providerId' in message) {
    const metricId = 'metricId' in message && typeof message.metricId === 'string' ? message.metricId : undefined;
    const pickerMode = 'pickerMode' in message && message.pickerMode === 'reset' ? 'reset' : 'metrics';
    // startPicker itself replaces any previous host; do not removeOrphan first (re-inject races).
    try {
      startPicker(String(message.providerId), metricId, pickerMode);
      sendResponse({ ok: true, pickerActive: isPickerActive() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'startPicker failed' });
    }
    return false;
  }
  if (message.type !== 'CAPTURE_NOW') return false;
  // Avoid heavy capture work while the user is teaching — SPA re-injects used to race and clear the panel.
  if (isPickerActive()) {
    sendResponse({ ok: true, skipped: 'picker_active' });
    return false;
  }
  void capture(true).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

// Do not call removeOrphanPickers() on load: re-executing content.js in a new isolate would
// delete the previous isolate's open picker host ("panel flashes then vanishes").
void capture();
