import type { PickerMode, ProviderContext } from '../shared/messages';
import type { NormalizedSnapshot, ProviderConfig } from '../shared/schema';
import { diagLog, perfLog, perfNow } from '../shared/perf';
import { sendMessage } from '../shared/runtime';
import { readAnchorText, readTaught } from './teach/read';
import { isPickerActive, startPicker } from './teach/picker';

let lastCapturedUrl: string | null = null;
let captureInFlight = false;
let captureQueued = false;
/** Keeps a queued refresh pinned to the entry it was requested for (multi-account URLs). */
let queuedProviderId: string | undefined;

function urlKey(): string {
  const url = new URL(location.href);
  url.hash = '';
  return url.toString();
}

function pageOnlySnapshot(provider: ProviderConfig): NormalizedSnapshot {
  return {
    providerId: provider.id,
    displayName: provider.displayName,
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

/** Mismatch is an ordinary state on a shared usage URL — another account is simply signed in. */
const ACCOUNT_MISMATCH_REASON = 'This page is signed in to a different account. Switch accounts in the browser, then refresh.';
const ACCOUNT_UNKNOWN_REASON = 'Could not tell which account this page belongs to. Teach the account on this page first.';

type ProviderResolution =
  | { provider: ProviderConfig; reason?: undefined }
  | { provider: null; reason: string };

/**
 * Decide which registered entry the page in front of us belongs to.
 *
 * Several providers can share one usage URL (the same service signed in with different
 * accounts), so a capture must never be written before the account is identified — writing to
 * the wrong entry would silently replace another account's numbers.
 */
async function resolveTargetProvider(context: ProviderContext, forcedProviderId?: string): Promise<ProviderResolution> {
  const candidates = context.candidates?.length ? context.candidates : [context.provider];
  const forced = forcedProviderId ? candidates.find((item) => item.id === forcedProviderId) : undefined;
  if (forcedProviderId && !forced) return { provider: null, reason: 'forced_provider_not_registered_here' };
  if (candidates.length === 1) return { provider: forced ?? candidates[0]! };

  const identified = candidates.filter((item) => item.accountAnchor && item.accountKeyHash);
  if (identified.length === 0) {
    // Nothing tells the accounts apart. An explicit refresh still targets one entry; an
    // automatic capture stays silent instead of guessing.
    return forced ? { provider: forced } : { provider: null, reason: 'ambiguous_no_account_anchor' };
  }
  const scope = forced?.accountKeyHash ? [forced] : identified;
  const readings = scope
    .map((item) => ({ providerId: item.id, text: item.accountAnchor ? readAnchorText(document, item.accountAnchor) : null }))
    .filter((item): item is { providerId: string; text: string } => item.text != null);
  if (readings.length === 0) return { provider: null, reason: 'account_anchor_unreadable' };
  const resolved = await sendMessage<{ providerId: string | null }>({ type: 'RESOLVE_ACCOUNT', readings });
  const match = resolved?.providerId ? candidates.find((item) => item.id === resolved.providerId) ?? null : null;
  if (!match) {
    // An entry with no identity of its own is the only place an unrecognised page may land.
    if (forced && !forced.accountKeyHash) return { provider: forced };
    return { provider: null, reason: 'account_not_recognized' };
  }
  if (forced && match.id !== forced.id) return { provider: null, reason: 'account_mismatch' };
  return { provider: match };
}

async function capture(force = false, forcedProviderId?: string): Promise<void> {
  if (captureInFlight) {
    if (force) {
      captureQueued = true;
      queuedProviderId = forcedProviderId;
    }
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
    const resolution = await resolveTargetProvider(context, forcedProviderId);
    const provider = resolution.provider;
    if (!provider) {
      diagLog('content.capture.skip', {
        reason: resolution.reason,
        candidates: context.candidates?.length ?? 1,
        forced: Boolean(forcedProviderId),
      });
      // An explicit refresh must not hang waiting for a result that will never come.
      if (forcedProviderId) {
        const mismatched = resolution.reason === 'account_mismatch' || resolution.reason === 'account_not_recognized';
        await sendMessage({
          type: 'CAPTURE_FAILURE',
          providerId: forcedProviderId,
          reason: mismatched ? ACCOUNT_MISMATCH_REASON : ACCOUNT_UNKNOWN_REASON,
        });
      }
      return;
    }
    diagLog('content.capture.start', {
      force,
      mode: provider.mode,
      providerId: provider.id,
      candidates: context.candidates?.length ?? 1,
      taughtCount: provider.metrics.filter((m) => m.enabled && m.valueAnchor).length,
      href: `${location.pathname}${location.search}`,
    });
    await waitForHydration();
    const readStartedAt = perfNow();
    let snapshot = provider.mode === 'embed'
      ? pageOnlySnapshot(provider)
      : provider.mode === 'taught'
        ? readTaught(document, provider)
        : {
          ...pageOnlySnapshot(provider),
          warningReason: 'Auto detection is preview-only. Track the exact usage element to show a metric.',
        };
    // Grok-style usage sheets mount after first paint — retry while taught metrics stay empty.
    if (
      provider.mode === 'taught'
      && snapshot.metrics.length === 0
      && provider.metrics.some((metric) => metric.enabled && metric.valueAnchor)
    ) {
      for (const waitMs of [800, 1_500, 2_500]) {
        diagLog('content.capture.retry', {
          providerId: provider.id,
          waitMs,
          previousStatus: snapshot.status,
        });
        await new Promise<void>((resolve) => window.setTimeout(resolve, waitMs));
        snapshot = readTaught(document, provider);
        if (snapshot.metrics.length > 0) break;
      }
    }
    perfLog('content.readSnapshot', readStartedAt, { mode: provider.mode, providerId: provider.id, metrics: snapshot.metrics.length }, 20);
    diagLog('content.capture.result', {
      providerId: provider.id,
      status: snapshot.status,
      metrics: snapshot.metrics.length,
      warning: Boolean(snapshot.warningReason),
    });
    await sendMessage({ type: 'CAPTURE_RESULT', providerId: provider.id, snapshot });
    lastCapturedUrl = key;
  } catch (error) {
    diagLog('content.capture.error', { name: error instanceof Error ? error.name : 'unknown' });
    // Report against the entry the refresh targeted; fall back to whatever this URL resolves to.
    const failedProviderId = forcedProviderId
      ?? (await sendMessage<ProviderContext | null>({ type: 'GET_PROVIDER_CONTEXT', url: location.href })
        .catch(() => null))?.provider.id;
    if (failedProviderId) {
      await sendMessage({ type: 'CAPTURE_FAILURE', providerId: failedProviderId, reason: error instanceof Error ? error.message : 'capture failed' });
    }
  } finally {
    perfLog('content.capture', startedAt, { force, href: location.href }, 50);
    captureInFlight = false;
    if (captureQueued) {
      captureQueued = false;
      const queued = queuedProviderId;
      queuedProviderId = undefined;
      void capture(true, queued);
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
    const requestedMode = 'pickerMode' in message && typeof message.pickerMode === 'string' ? message.pickerMode : '';
    const pickerMode: PickerMode = requestedMode === 'reset' || requestedMode === 'account' ? requestedMode : 'metrics';
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
  const pinnedProviderId = 'providerId' in message && typeof message.providerId === 'string' ? message.providerId : undefined;
  void capture(true, pinnedProviderId).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

// Do not call removeOrphanPickers() on load: re-executing content.js in a new isolate would
// delete the previous isolate's open picker host ("panel flashes then vanishes").
void capture();
