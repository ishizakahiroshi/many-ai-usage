import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DashboardResponse } from '../shared/messages';
import { ageLabel, formatMetric, remainingPercent, resetLabel, statusLabel } from '../shared/format';
import type { NormalizedMetric, ProviderConfig, ProviderRuntimeState } from '../shared/schema';
import { sendMessage } from '../shared/runtime';
import { originPattern } from '../shared/url';
import './styles.css';

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

function openOptions() {
  void chrome.runtime.openOptionsPage();
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

function faviconUrl(provider: ProviderConfig): string | null {
  try { return `${new URL(provider.url).origin}/favicon.ico`; } catch { return null; }
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
        <div class="provider-name" title={provider.url}>{provider.displayName}</div>
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
            <button onClick={openOptions}>⚙ Settings</button>
          </div>
        </div>
      )}
    </article>
  );
}

function IssueCard({ provider, snapshot, state, reload }: { provider: ProviderConfig; snapshot: DashboardResponse['snapshots'][string]; state: ProviderRuntimeState; reload: () => void }) {
  const tile = snapshot?.source === 'page_only';
  const needsTeaching = state.status === 'needs_teaching';
  const title = state.status === 'needs_permission' ? 'Permission needed' : needsTeaching ? 'Re-teach needed' : tile ? 'Page tile' : state.status === 'never_seen' ? 'Ready to capture' : statusLabel(state);
  const favicon = tile && state.status === 'ok' ? faviconUrl(provider) : null;
  return (
    <article class="issue-card">
      <div class="issue-heading">{favicon ? <img class="tile-favicon" src={favicon} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}<strong>{provider.displayName}</strong><span class="status-badge">{title}</span></div>
      <p>{state.status === 'needs_permission' ? 'Allow access to this usage page so the dashboard can read its visible data locally.' : needsTeaching ? 'The taught value was not found three times. Track the value again on the usage page.' : tile ? 'No confident usage metric was found. Keep this page as a link tile, or try parsing again.' : state.errorLabel ?? 'Open the page once to capture a local snapshot.'}</p>
      <div class="issue-actions">
        {state.status === 'needs_permission' && <button onClick={() => void allowAccess(provider, reload)}>Allow access</button>}
        {needsTeaching && (provider.metrics.length > 0
          ? provider.metrics.filter((metric) => metric.enabled && metric.valueAnchor).map((metric) => <button key={metric.metricId} onClick={() => void sendMessage({ type: 'START_PICKER', providerId: provider.id, metricId: metric.metricId }).then(reload)}>{provider.metrics.length === 1 ? 'Re-teach' : `Re-teach ${metric.label}`}</button>)
          : <button onClick={() => void sendMessage({ type: 'START_PICKER', providerId: provider.id }).then(reload)}>Re-teach</button>)}
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
    const onStorageChanged = () => reload();
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
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
        <div><strong>many-ai-usage</strong><span>v0.1.0</span></div>
        <button class="text-button" onClick={openOptions}>⚙ options</button>
      </header>
      <section class="provider-list" aria-label="Usage providers">
        {normal.length === 0 && <div class="empty-state"><strong>Nothing captured yet</strong><span>Open a registered usage page to begin.</span></div>}
        {normal.map((provider) => <ProviderRow key={provider.id} provider={provider} snapshot={dashboard.snapshots[provider.id]} state={dashboard.runtimeStates[provider.id]} reload={reload} />)}
      </section>
      {issues.length > 0 && <section class="issues">
        <button class="issues-toggle" onClick={() => setIssuesOpen((value) => !value)} aria-expanded={issuesOpen}>▼ Needs attention · {issues.length}</button>
        {issuesOpen && <div class="issue-list">{issues.map((provider) => <IssueCard key={provider.id} provider={provider} snapshot={dashboard.snapshots[provider.id]} state={dashboard.runtimeStates[provider.id]} reload={reload} />)}</div>}
      </section>}
    </div>
  );
}

import { render } from 'preact';
render(<PopupApp />, document.getElementById('app')!);
