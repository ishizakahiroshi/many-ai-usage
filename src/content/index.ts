import type { ProviderContext } from '../shared/messages';
import type { NormalizedSnapshot } from '../shared/schema';
import { sendMessage } from '../shared/runtime';
import { readTaught } from './teach/read';
import { startPicker } from './teach/picker';

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
}

async function capture(force = false): Promise<void> {
  if (captureInFlight) {
    if (force) captureQueued = true;
    return;
  }
  const key = urlKey();
  if (!force && lastCapturedUrl === key) return;
  captureInFlight = true;
  try {
    const context = await sendMessage<ProviderContext | null>({ type: 'GET_PROVIDER_CONTEXT', url: location.href });
    if (!context?.permissionGranted) return;
    await waitForHydration();
    const snapshot = context.provider.mode === 'embed'
      ? pageOnlySnapshot(context)
      : context.provider.mode === 'taught'
        ? readTaught(document, context.provider)
        : {
          ...pageOnlySnapshot(context),
          warningReason: 'Auto detection is preview-only. Track the exact usage element to show a metric.',
        };
    await sendMessage({ type: 'CAPTURE_RESULT', providerId: context.provider.id, snapshot });
    lastCapturedUrl = key;
  } catch (error) {
    const provider = await sendMessage<ProviderContext | null>({ type: 'GET_PROVIDER_CONTEXT', url: location.href }).catch(() => null);
    if (provider) {
      await sendMessage({ type: 'CAPTURE_FAILURE', providerId: provider.provider.id, reason: error instanceof Error ? error.message : 'capture failed' });
    }
  } finally {
    captureInFlight = false;
    if (captureQueued) {
      captureQueued = false;
      void capture(true);
    }
  }
}

chrome.runtime.onMessage.addListener((message: { type?: string }, _sender, sendResponse) => {
  if (message.type === 'START_PICKER' && 'providerId' in message) {
    const metricId = 'metricId' in message && typeof message.metricId === 'string' ? message.metricId : undefined;
    const pickerMode = 'pickerMode' in message && message.pickerMode === 'reset' ? 'reset' : 'metrics';
    startPicker(String(message.providerId), metricId, pickerMode);
    sendResponse({ ok: true });
    return false;
  }
  if (message.type !== 'CAPTURE_NOW') return false;
  void capture(true).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

void capture();
