import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DashboardResponse } from '../shared/messages';
import { ageLabel, formatMetric, remainingPercent, resetLabel, statusLabel } from '../shared/format';
import type { NormalizedMetric, ProviderConfig, ProviderRuntimeState } from '../shared/schema';
import { USAGE_GUIDE_URL } from '../shared/samples';
import { obsLog } from '../shared/perf';
import { sendMessage } from '../shared/runtime';
import { originPattern } from '../shared/url';
import './styles.css';

function teachFailMessage(reason?: string): string {
  if (reason === 'permission_denied') return 'Host permission is required. Click Allow access, then Re-teach again.';
  if (reason === 'provider_missing') return 'Provider was not found. Open Settings and check Grok is registered.';
  if (reason === 'content_script_unreachable') return 'Could not attach teach mode on the page. Open https://grok.com/?_s=usage , then Re-teach again.';
  if (reason === 'tab_create_failed') return 'Could not open a browser tab for teaching.';
  return 'Could not start teach mode. Open the usage page and try Re-teach again.';
}

function level(metric: NormalizedMetric): string {
  const value = remainingPercent(metric);
  if (value == null) return 'neutral';
  if (value < 30) return 'bad';
  if (value < 70) return 'warn';
  return 'ok';
}

function lowestMetric(metrics: NormalizedMetric[]): string | null {
  const candidates = metrics
    .map((metric) => ({ id: metric.id, value: remainingPercent(metric) }))
    .filter((item): item is { id: string; value: number } => item.value != null);
  return candidates.sort((a, b) => a.value - b.value)[0]?.id ?? null;
}

function openOptions(providerId?: string) {
  const qs = providerId ? `?provider=${encodeURIComponent(providerId)}` : '';
  const url = chrome.runtime.getURL(`options.html${qs}`);
  // Background re-navigates zombie options tabs after extension reload.
  // If the SW does not answer (sleep/hang), open from the popup as a fallback.
  obsLog('popup.openOptions.click', { hasProvider: Boolean(providerId) });
  let settled = false;
  const fallback = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    obsLog('popup.openOptions.path', { path: 'fallback-timeout-700ms' });
    void chrome.tabs.create({ url, active: true });
  }, 700);
  void sendMessage<{ opened?: boolean; tabId?: number }>({ type: 'OPEN_OPTIONS', providerId })
    .then((result) => {
      if (settled) {
        obsLog('popup.openOptions.path', { path: 'bg-late-after-fallback', opened: result?.opened ?? false, tabId: result?.tabId });
        return;
      }
      settled = true;
      window.clearTimeout(fallback);
      if (!result?.opened) {
        obsLog('popup.openOptions.path', { path: 'popup-create-after-bg-false' });
        void chrome.tabs.create({ url, active: true });
        return;
      }
      obsLog('popup.openOptions.path', { path: 'bg', opened: true, tabId: result.tabId });
    })
    .catch((error: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      obsLog('popup.openOptions.path', {
        path: 'popup-create-after-bg-error',
        error: error instanceof Error ? error.name : 'unknown',
      });
      void chrome.tabs.create({ url, active: true });
    });
}

function openSampleOptions() {
  void chrome.tabs.create({ url: chrome.runtime.getURL('options.html?trySamples=1'), active: true });
}

function openUsageGuide() {
  void chrome.tabs.create({ url: USAGE_GUIDE_URL, active: true });
}

function refresh(providerId: string, reload: () => void) {
  void sendMessage({ type: 'REFRESH_PROVIDER', providerId }).then(() => window.setTimeout(reload, 350));
}

async function allowAccess(provider: ProviderConfig, reload: () => void): Promise<void> {
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [originPattern(provider.url)] }); } catch { granted = false; }
  await sendMessage({ type: 'SYNC_PERMISSION', providerId: provider.id, granted });
  reload();
}

function MiniMetric({ metric, lowest }: { metric: NormalizedMetric; lowest: boolean }) {
  const value = remainingPercent(metric);
  return (
    <div class={`mini-metric ${lowest ? 'lowest' : ''}`} title={metric.evidence.value}>
      <div class="mini-topline">
        {lowest && <span class="lowest-mark" aria-label="lowest remaining">▶</span>}
        <span class="window-label">{metric.window.label}</span>
        <strong>{formatMetric(metric)}</strong>
      </div>
      <div class="mini-bar" aria-hidden="true"><span class={`bar-fill ${level(metric)}`} style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} /></div>
      <div class="reset-label">{resetLabel(metric)}</div>
    </div>
  );
}

function ProviderRow({ provider, snapshot, state, reload }: { provider: ProviderConfig; snapshot: DashboardResponse['snapshots'][string]; state: ProviderRuntimeState; reload: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const lowest = useMemo(() => lowestMetric(snapshot?.metrics ?? []), [snapshot]);
  const metrics = snapshot?.metrics ?? [];
  return (
    <article class={`provider-row ${expanded ? 'expanded' : ''}`}>
      <div class="row-main">
        <div class="provider-name" title={provider.url}>
          {provider.iconDataUrl
            ? <img class="provider-icon" src={provider.iconDataUrl} alt="" aria-hidden="true" />
            : null}
          <span class="provider-name-text">{provider.displayName}</span>
        </div>
        <div class="windows" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, metrics.length))}, minmax(0, 1fr))` }}>
          {metrics.length > 0 ? metrics.map((metric) => <MiniMetric key={metric.id} metric={metric} lowest={metric.id === lowest} />) : <span class="empty-value">No usage captured</span>}
        </div>
        <button class="icon-button" onClick={() => refresh(provider.id, reload)} title="Refresh now" aria-label={`Refresh ${provider.displayName}`}>↻</button>
        <button class="icon-button" onClick={() => setExpanded((value) => !value)} title="Show details" aria-expanded={expanded} aria-label={`Details for ${provider.displayName}`}>{expanded ? '▴' : '▾'}</button>
      </div>
      {expanded && (
        <div class="row-details">
          <span>confidence: {state.confidence}</span>
          <span>source: {snapshot?.source ?? '—'}</span>
          <span>captured: {ageLabel(snapshot?.capturedAt ?? null)}</span>
          <div class="row-actions">
            <button onClick={() => void sendMessage({ type: 'OPEN_PROVIDER', providerId: provider.id })}>↗ Open page</button>
            <button onClick={() => openOptions(provider.id)}>⚙ Settings</button>
          </div>
        </div>
      )}
    </article>
  );
}

function IssueCard({ provider, snapshot, state, reload }: { provider: ProviderConfig; snapshot: DashboardResponse['snapshots'][string]; state: ProviderRuntimeState; reload: () => void }) {
  const [teachError, setTeachError] = useState('');
  const [teachBusy, setTeachBusy] = useState(false);
  const tile = snapshot?.source === 'page_only';
  const needsTeaching = state.status === 'needs_teaching';
  // Snapshot may say "Re-teach needed for: …" while runtime status is still warning (not yet 3 failures).
  const reteachMessage = snapshot?.warningReason ?? snapshot?.lastFailureReason ?? state.errorLabel ?? '';
  const reteachMentioned = /re-teach|reteach|教え直/i.test(reteachMessage);
  const taughtMetrics = provider.metrics.filter((metric) => metric.enabled && metric.valueAnchor);
  // Must offer a teach entry whenever the UI tells the user to re-teach — Warning alone used to hide the button.
  const showReteach = state.status !== 'needs_permission' && (
    needsTeaching
    || reteachMentioned
    || (taughtMetrics.length > 0 && (state.status === 'warning' || state.status === 'error'))
  );
  const showTrack = state.status !== 'needs_permission' && taughtMetrics.length === 0 && !tile;
  const title = state.status === 'needs_permission'
    ? 'Permission needed'
    : needsTeaching || reteachMentioned
      ? 'Re-teach needed'
      : tile
        ? 'Page tile'
        : state.status === 'never_seen'
          ? 'Ready to capture'
          : statusLabel(state);
  const body = state.status === 'needs_permission'
    ? 'Allow access to this usage page so the dashboard can read its visible data locally.'
    : needsTeaching
      ? 'The taught value was not found three times. Track the value again on the usage page.'
      : reteachMessage
        ? reteachMessage
        : tile
          ? 'No confident usage metric was found. Keep this page as a link tile, or try parsing again.'
          : state.errorLabel ?? 'Open the page once to capture a local snapshot.';
  const ensurePermission = async (): Promise<boolean> => {
    try {
      const origin = originPattern(provider.url);
      const allowed = await chrome.permissions.contains({ origins: [origin] });
      if (allowed) return true;
      const granted = await chrome.permissions.request({ origins: [origin] });
      await sendMessage({ type: 'SYNC_PERMISSION', providerId: provider.id, granted });
      if (!granted) {
        setTeachError(teachFailMessage('permission_denied'));
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const startTeach = (metricId?: string, options?: { resetFirst?: boolean }) => {
    setTeachError('');
    setTeachBusy(true);
    void (async () => {
      try {
        if (!(await ensurePermission())) return;
        if (options?.resetFirst) {
          await sendMessage({ type: 'RESET_TEACH', providerId: provider.id });
        }
        const result = await sendMessage<{ started?: boolean; reason?: string }>({
          type: 'START_PICKER',
          providerId: provider.id,
          // After reset, always start a fresh multi-metric teach (no broken metric id).
          metricId: options?.resetFirst ? undefined : metricId,
        });
        if (!result?.started) {
          setTeachError(teachFailMessage(result?.reason));
          obsLog('popup.teach.failed', { providerId: provider.id, reason: result?.reason ?? 'unknown' });
        } else {
          window.close();
        }
      } catch (error) {
        setTeachError(teachFailMessage());
        obsLog('popup.teach.exception', { error: error instanceof Error ? error.name : 'unknown' });
      } finally {
        setTeachBusy(false);
        reload();
      }
    })();
  };
  return (
    <article class="issue-card">
      <div class="issue-heading">
        {provider.iconDataUrl ? <img class="provider-icon" src={provider.iconDataUrl} alt="" aria-hidden="true" /> : null}
        <strong>{provider.displayName}</strong>
        <span class="status-badge">{title}</span>
      </div>
      <p>{body}</p>
      {teachError ? <p class="teach-error">{teachError}</p> : null}
      <div class="issue-actions">
        {state.status === 'needs_permission' && <button onClick={() => void allowAccess(provider, reload)}>Allow access</button>}
        {showReteach && (
          <button
            class="primary-action"
            disabled={teachBusy}
            onClick={() => startTeach(undefined, { resetFirst: true })}
            title="Delete broken tracks and open teach mode for a clean total"
          >
            Fix tracking
          </button>
        )}
        {showReteach && taughtMetrics.length > 0
          ? taughtMetrics.map((metric) => (
            <button key={metric.metricId} disabled={teachBusy} onClick={() => startTeach(metric.metricId)}>
              {taughtMetrics.length === 1 ? 'Re-teach' : `Re-teach ${metric.label}`}
            </button>
          ))
          : null}
        {showTrack && <button class="primary-action" disabled={teachBusy} onClick={() => startTeach()}>＋ Track</button>}
        <button onClick={() => void sendMessage({ type: 'OPEN_PROVIDER', providerId: provider.id })}>↗ Open</button>
        <button onClick={() => refresh(provider.id, reload)}>{tile ? 'Re-parse' : 'Capture'}</button>
        {state.status === 'needs_permission' && <button class="danger-button" onClick={() => void sendMessage({ type: 'DELETE_PROVIDER', providerId: provider.id }).then(reload)}>Delete</button>}
      </div>
    </article>
  );
}

function PopupApp() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const reload = () => void sendMessage<DashboardResponse>({ type: 'GET_DASHBOARD' }).then(setDashboard);
  useEffect(reload, []);
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onStorageChanged = () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        reload();
      }, 120);
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      if (debounceTimer != null) clearTimeout(debounceTimer);
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  if (!dashboard) return <div class="popup-shell loading">Loading usage…</div>;
  const normal = dashboard.providers.filter((provider) => {
    const state = dashboard.runtimeStates[provider.id];
    const snapshot = dashboard.snapshots[provider.id];
    return state?.status === 'ok' || state?.status === 'warning' || state?.status === 'stale' ? Boolean(snapshot?.metrics.length) : false;
  });
  const issues = dashboard.providers.filter((provider) => !normal.some((item) => item.id === provider.id));
  return (
    <div class="popup-shell">
      <header class="popup-header">
        <div class="brand">
          <img class="app-icon" src={chrome.runtime.getURL('assets/icons/icon-192.png')} width={22} height={22} alt="" />
          <strong>many-ai-usage</strong>
          <span>v0.1.0</span>
        </div>
        <button class="text-button" onClick={() => openOptions()}>⚙ options</button>
      </header>
      <section class="provider-list" aria-label="Usage providers">
        {normal.length === 0 && <div class="empty-state"><strong>{dashboard.providers.length === 0 ? 'No providers yet' : 'Nothing captured yet'}</strong><span>{dashboard.providers.length === 0 ? 'Try six URL-only samples, or add your own usage page.' : 'Open a registered usage page to begin.'}</span>{dashboard.providers.length === 0 && <div class="empty-actions"><button class="sample-button" onClick={openSampleOptions}>Try samples ▸</button><button onClick={openUsageGuide}>使い方を見る →</button></div>}</div>}
        {normal.map((provider) => <ProviderRow key={provider.id} provider={provider} snapshot={dashboard.snapshots[provider.id]} state={dashboard.runtimeStates[provider.id]} reload={reload} />)}
      </section>
      {issues.length > 0 && <section class="issues">
        <button class="issues-toggle" onClick={() => setIssuesOpen((value) => !value)} aria-expanded={issuesOpen}>▼ Needs attention · {issues.length}</button>
        {issuesOpen && <div class="issue-list">{issues.map((provider) => <IssueCard key={provider.id} provider={provider} snapshot={dashboard.snapshots[provider.id]} state={dashboard.runtimeStates[provider.id]} reload={reload} />)}</div>}
      </section>}
      <footer class="popup-footer">
        <button type="button" class="text-button footer-link" onClick={() => {
          void chrome.tabs.create({ url: chrome.runtime.getURL('options.html?report=1'), active: true });
        }}>不具合を報告</button>
      </footer>
    </div>
  );
}

import { render } from 'preact';
render(<PopupApp />, document.getElementById('app')!);
