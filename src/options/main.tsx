import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DashboardResponse } from '../shared/messages';
import { ageLabel, formatMetric, remainingPercent, statusLabel } from '../shared/format';
import { fileToIconDataUrl } from '../shared/icon';
import type { ProviderConfig, ProviderMode } from '../shared/schema';
import { fetchProvidersRegistry, isSampleProviderId, PROVIDERS_REGISTRY_URL, USAGE_GUIDE_URL } from '../shared/samples';
import { applyRegistryProviders } from '../shared/storage';
import { sendMessage } from '../shared/runtime';
import { originChanged, originPattern, urlWithoutHash } from '../shared/url';
import './styles.css';

type ProviderDraft = Pick<ProviderConfig, 'id' | 'displayName' | 'url' | 'refreshIntervalMinutes' | 'mode' | 'order' | 'createdAt' | 'updatedAt' | 'iconDataUrl'>;

function blankDraft(order = 0): ProviderDraft {
  return { id: '', displayName: '', url: '', refreshIntervalMinutes: 15, mode: 'auto', order, createdAt: '', updatedAt: '', iconDataUrl: undefined };
}

function draftFrom(provider: ProviderConfig): ProviderDraft {
  const { id, displayName, url, refreshIntervalMinutes, mode, order, createdAt, updatedAt, iconDataUrl } = provider;
  return { id, displayName, url, refreshIntervalMinutes, mode, order, createdAt, updatedAt, iconDataUrl };
}

function validUrl(value: string): boolean {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

async function permissionFor(url: string): Promise<boolean> {
  if (!validUrl(url)) return false;
  try { return await chrome.permissions.contains({ origins: [originPattern(url)] }); } catch { return false; }
}

async function requestPermission(url: string): Promise<boolean> {
  if (!validUrl(url)) return false;
  try { return await chrome.permissions.request({ origins: [originPattern(url)] }); } catch { return false; }
}

function OptionsApp() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(blankDraft());
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [samplesDialogOpen, setSamplesDialogOpen] = useState(() => new URLSearchParams(window.location.search).get('trySamples') === '1');
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [samplesError, setSamplesError] = useState('');

  const reload = () => void sendMessage<DashboardResponse>({ type: 'GET_DASHBOARD' }).then((next) => {
    setDashboard(next);
    if (selectedId == null && next.providers[0]) {
      setSelectedId(next.providers[0].id);
      setDraft(draftFrom(next.providers[0]));
    }
    if (selectedId && selectedId !== 'new' && !dirty) {
      const selected = next.providers.find((provider) => provider.id === selectedId);
      if (selected) setDraft(draftFrom(selected));
    }
  });
  useEffect(reload, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('trySamples')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  useEffect(() => {
    const onStorageChanged = () => reload();
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => chrome.storage.onChanged.removeListener(onStorageChanged);
  }, [selectedId, dirty]);

  const selectedProvider = useMemo(() => dashboard?.providers.find((provider) => provider.id === selectedId) ?? null, [dashboard, selectedId]);
  const selectedSnapshot = selectedProvider && dashboard ? dashboard.snapshots[selectedProvider.id] : null;
  const selectedState = selectedProvider && dashboard ? dashboard.runtimeStates[selectedProvider.id] : null;
  const showTrySamples = dashboard ? !dashboard.providers.some((provider) => isSampleProviderId(provider.id)) : false;

  const select = (id: string | 'new') => {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    setSelectedId(id);
    setMessage('');
    if (id === 'new') setDraft(blankDraft(dashboard?.providers.length ?? 0));
    else {
      const provider = dashboard?.providers.find((item) => item.id === id);
      if (provider) setDraft(draftFrom(provider));
    }
    setDirty(false);
  };

  const updateDraft = <K extends keyof ProviderDraft>(key: K, value: ProviderDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage('');
  };

  const save = async () => {
    if (!draft.displayName.trim()) return setMessage('Add a display name.');
    if (!validUrl(draft.url)) return setMessage('Enter an http(s) usage page URL.');
    const now = new Date().toISOString();
    const existing = selectedProvider;
    let granted = await permissionFor(draft.url);
    if (!granted || (existing && originChanged(existing.url, draft.url))) {
      setMessage('Requesting access to this host…');
      granted = await requestPermission(draft.url);
    }
    const provider: ProviderConfig = {
      schema: 'many-ai-usage.provider.v1',
      id: draft.id || `custom:${crypto.randomUUID?.() ?? Date.now()}`,
      displayName: draft.displayName.trim(),
      url: draft.url,
      urlMatch: [`${urlWithoutHash(draft.url)}*`],
      mode: draft.mode,
      displayEnabled: true,
      refreshIntervalMinutes: Math.max(3, Math.min(240, Number(draft.refreshIntervalMinutes) || 15)),
      metrics: existing?.metrics ?? [],
      ...(draft.iconDataUrl ? { iconDataUrl: draft.iconDataUrl } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      order: existing?.order ?? draft.order,
    };
    await sendMessage({ type: 'UPSERT_PROVIDER', provider, permissionGranted: granted });
    setSelectedId(provider.id);
    setDraft(draftFrom(provider));
    setDirty(false);
    setMessage(granted ? 'Saved. Open the usage page to capture its local snapshot.' : 'Saved, but host access is still required.');
    reload();
  };

  const remove = async () => {
    if (!selectedProvider || !window.confirm(`Delete ${selectedProvider.displayName}?`)) return;
    await sendMessage({ type: 'DELETE_PROVIDER', providerId: selectedProvider.id });
    setSelectedId(null);
    setDirty(false);
    reload();
  };

  const allowSelected = async () => {
    if (!selectedProvider) return;
    const granted = await requestPermission(draft.url || selectedProvider.url);
    await sendMessage({ type: 'SYNC_PERMISSION', providerId: selectedProvider.id, granted });
    setMessage(granted ? 'Host access granted.' : 'Host access was denied.');
    reload();
  };

  const trackSelected = async (metricId?: string, pickerMode: 'metrics' | 'reset' = 'metrics') => {
    if (!selectedProvider) return;
    let granted = await permissionFor(selectedProvider.url);
    if (!granted) {
      granted = await requestPermission(selectedProvider.url);
      await sendMessage({ type: 'SYNC_PERMISSION', providerId: selectedProvider.id, granted });
    }
    if (!granted) {
      setMessage('Host access is required before teaching this page.');
      reload();
      return;
    }
    // Keep this options tab alive so Done/Cancel can return here and later popup opens still find it.
    try {
      const tab = await chrome.tabs.getCurrent();
      if (tab?.id != null) await chrome.tabs.update(tab.id, { autoDiscardable: false });
    } catch {
      /* options may not expose getCurrent in all hosts */
    }
    const result = await sendMessage<{ started?: boolean }>({ type: 'START_PICKER', providerId: selectedProvider.id, metricId, pickerMode });
    setMessage(result?.started === false
      ? 'Unable to open the registered page. Check host access and try again.'
      : pickerMode === 'reset'
        ? 'A new teaching tab opened. Choose the reset date or countdown, then select Done and return.'
        : 'A new teaching tab opened. Choose one or more usage values, then select Done and return.');
  };

  const onIconFile = async (file: File | null) => {
    if (!file) return;
    try {
      const iconDataUrl = await fileToIconDataUrl(file);
      updateDraft('iconDataUrl', iconDataUrl);
      setMessage('Icon ready. Save to apply.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to read that image.');
    }
  };

  const clearIcon = () => {
    updateDraft('iconDataUrl', undefined);
    setMessage('Icon cleared. Save to apply.');
  };

  const renameMetric = async (metricId: string, currentLabel: string) => {
    if (!selectedProvider) return;
    const label = window.prompt('Metric name', currentLabel)?.trim();
    if (!label) return;
    await sendMessage({ type: 'RENAME_METRIC', providerId: selectedProvider.id, metricId, label });
    setMessage('Tracked metric renamed.');
    reload();
  };

  const removeMetric = async (metricId: string) => {
    if (!selectedProvider) return;
    await sendMessage({ type: 'REMOVE_METRIC', providerId: selectedProvider.id, metricId });
    setMessage('Tracked metric removed.');
    reload();
  };

  const reorder = async (fromId: string, toId: string) => {
    if (fromId === toId || !dashboard) return;
    const ids = dashboard.providers.map((provider) => provider.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    await sendMessage({ type: 'REORDER_PROVIDERS', ids });
    setDraggedId(null);
    reload();
  };

  const openSamplesDialog = () => {
    setSamplesError('');
    setSamplesDialogOpen(true);
  };

  const importSamples = async () => {
    setSamplesLoading(true);
    setSamplesError('');
    try {
      const providers = await fetchProvidersRegistry();
      const result = await applyRegistryProviders(providers);
      setSamplesDialogOpen(false);
      setMessage(result.added.length > 0
        ? `Added ${result.added.length} sample providers. Open each usage page and teach the visible value.`
        : 'Sample providers are already registered. Existing settings were not changed.');
      reload();
    } catch (error) {
      setSamplesError(error instanceof Error ? error.message : 'Unable to fetch sample providers.');
    } finally {
      setSamplesLoading(false);
    }
  };

  if (!dashboard) return <div class="options-loading">Loading settings…</div>;
  return (
    <div class="options-shell">
      <header class="options-header"><div><strong>many-ai-usage</strong><span>Settings · v0.1.0</span></div><span class="privacy-note">Local-only · read-only page capture</span></header>
      <div class="options-layout">
        <aside class="sidebar">
          <button class="add-button" onClick={() => select('new')}>＋ New provider</button>
          {showTrySamples && <div class="samples-onboarding">
            <strong>Need a starting point?</strong>
            <span>Fetch six URL-only samples, then teach the values you want to track.</span>
            <button class="samples-button" onClick={openSamplesDialog}>Try samples ▸</button>
            <a href={USAGE_GUIDE_URL} target="_blank" rel="noopener noreferrer">使い方を見る →</a>
          </div>}
          <div class="sidebar-label">Registered providers</div>
          <div class="provider-sidebar-list">
            {dashboard.providers.map((provider) => {
              const state = dashboard.runtimeStates[provider.id];
              const snapshot = dashboard.snapshots[provider.id];
              const lowest = snapshot?.metrics.map(remainingPercent).filter((value): value is number => value != null).sort((a, b) => a - b)[0];
              return <button key={provider.id} class={`sidebar-provider ${selectedId === provider.id ? 'selected' : ''}`} draggable onDragStart={() => setDraggedId(provider.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedId && void reorder(draggedId, provider.id)} onClick={() => select(provider.id)}>
                <span class="drag-handle">☰</span>
                {provider.iconDataUrl
                  ? <img class="provider-icon" src={provider.iconDataUrl} alt="" aria-hidden="true" />
                  : <span class="provider-icon placeholder" aria-hidden="true" />}
                <span class="sidebar-provider-main"><strong>{provider.displayName}</strong><small>{lowest != null ? `${Math.round(lowest)}% remaining` : state.status === 'needs_permission' ? 'Needs access' : snapshot?.source === 'page_only' ? 'tile' : 'Not captured'}</small></span><span class={`sidebar-state ${state.status}`}>{state.status === 'needs_permission' ? '要許可' : snapshot?.source === 'page_only' ? 'tile' : ''}</span>
              </button>;
            })}
          </div>
        </aside>
        <main class="main-panel">
          <div class="panel-heading">
            <div><h1>{selectedId === 'new' ? 'New provider' : selectedProvider?.displayName ?? 'Select a provider'}</h1>{selectedProvider && <span class={`status-badge ${selectedState?.status}`}>{statusLabel(selectedState!)}</span>}</div>
            {selectedProvider && <span class="last-captured">{ageLabel(selectedSnapshot?.capturedAt ?? null)}</span>}
          </div>
          {selectedProvider && selectedState?.status === 'needs_permission' && <div class="permission-callout"><div><strong>Host access is required</strong><span>Allow access to parse visible usage data in your browser session.</span></div><div><button onClick={() => void allowSelected()}>Allow access</button><button class="danger-button" onClick={() => void remove()}>Delete</button></div></div>}
          {selectedId === 'new' || selectedProvider ? <>
            {selectedProvider && <section class="current-section"><div class="section-heading"><h2>Current usage</h2><div class="section-actions"><button onClick={() => void sendMessage({ type: 'REFRESH_PROVIDER', providerId: selectedProvider.id }).then(reload)}>↻ Refresh now</button><button onClick={() => void sendMessage({ type: 'OPEN_PROVIDER', providerId: selectedProvider.id })}>↗ Open page</button></div></div>{selectedSnapshot?.metrics.length ? <div class="metric-grid">{selectedSnapshot.metrics.map((metric) => <div class="metric-card" key={metric.id}><span>{metric.window.label}</span><strong>{formatMetric(metric)}</strong><small>{metric.label}</small></div>)}</div> : <div class="no-metrics">No normalized usage values yet. Open the registered page after allowing host access.</div>}</section>}
            <section class="form-section">
              <div class="section-heading"><h2>Provider settings</h2><span>URL and display settings</span></div>
              <label>Display name<input value={draft.displayName} onInput={(event) => updateDraft('displayName', event.currentTarget.value)} placeholder="Example AI" /></label>
              <label>Usage page URL<input value={draft.url} onInput={(event) => updateDraft('url', event.currentTarget.value)} placeholder="https://example.com/account/usage" /></label>
              <p class="help-text">The page is read in your browser session. Cookies, tokens, and raw HTML are never stored or sent elsewhere.</p>
              <div class="icon-field">
                <div class="icon-preview-wrap">
                  {draft.iconDataUrl
                    ? <img class="icon-preview" src={draft.iconDataUrl} alt="" />
                    : <span class="icon-preview placeholder" aria-hidden="true" />}
                  <div>
                    <strong>Custom icon</strong>
                    <p class="help-text">Optional. Upload your own image — provider brand/favicon is never auto-loaded (trademark &amp; privacy). Stored only in this browser.</p>
                    <div class="icon-actions">
                      <label class="file-button">
                        Choose image
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => {
                          const input = event.currentTarget;
                          void onIconFile(input.files?.[0] ?? null).finally(() => { input.value = ''; });
                        }} />
                      </label>
                      <button type="button" disabled={!draft.iconDataUrl} onClick={clearIcon}>Remove</button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="form-grid">
                <label>Refresh interval (minutes)<input type="number" min="3" max="240" value={draft.refreshIntervalMinutes} onInput={(event) => updateDraft('refreshIntervalMinutes', Number(event.currentTarget.value))} /></label>
                <label>Mode<select value={draft.mode} onChange={(event) => updateDraft('mode', event.currentTarget.value as ProviderMode)}><option value="auto">Auto detect (candidate preview)</option><option value="taught">User taught</option><option value="embed">Page tile</option></select></label>
              </div>
              {selectedProvider && <div class="teach-panel"><div><strong>Teach this page</strong><p class="help-text">A new tab opens with a continuous picker. Click every usage value you want to track, then select Done and return.</p></div><button class="primary-button" onClick={() => void trackSelected()}>＋ Track this element</button></div>}
              {selectedProvider && selectedProvider.metrics.length > 0 && <div class="taught-metrics"><strong>Tracked elements</strong>{selectedProvider.metrics.map((metric) => { const lastValue = selectedSnapshot?.metrics.find((item) => item.id === metric.metricId); return <div class="taught-metric" key={metric.metricId}><span><b>{metric.label}</b><small>{metric.windowLabel ?? '—'} · {metric.valueAnchor?.selectors[0] ?? 'no selector'} · last: {lastValue ? formatMetric(lastValue) : 'not read'}</small></span><span class="metric-actions"><button onClick={() => void renameMetric(metric.metricId, metric.label)}>Rename</button><button onClick={() => void trackSelected(metric.metricId)}>Re-teach value</button><button onClick={() => void trackSelected(metric.metricId, 'reset')}>Re-teach reset</button><button onClick={() => void removeMetric(metric.metricId)}>Delete</button></span></div>; })}</div>}
            </section>
            {selectedProvider && <section class="diagnostic-section"><div class="section-heading"><h2>Diagnostics</h2><span>{selectedState?.errorLabel ?? 'Evidence summary'}</span></div><dl class="diagnostic-grid"><dt>Status</dt><dd>{selectedState?.status ?? 'never_seen'}</dd><dt>Source</dt><dd>{selectedSnapshot?.source ?? '—'}</dd><dt>Confidence</dt><dd>{selectedState?.confidence ?? 'none'}</dd><dt>Last captured</dt><dd>{ageLabel(selectedSnapshot?.capturedAt ?? null)}</dd><dt>Stale threshold</dt><dd>{draft.refreshIntervalMinutes * 2} minutes</dd><dt>Evidence</dt><dd>{selectedState?.evidenceSummary.join(' · ') || '—'}</dd></dl></section>}
            <div class="form-footer"><button class="danger-button" disabled={!selectedProvider} onClick={() => void remove()}>Delete</button><div><button disabled={!dirty} onClick={() => { if (selectedProvider) setDraft(draftFrom(selectedProvider)); else setDraft(blankDraft(dashboard.providers.length)); setDirty(false); setMessage(''); }}>Discard changes</button><button class="primary-button" disabled={!dirty} onClick={() => void save()}>Save</button></div></div>
            {message && <p class="save-message" role="status">{message}</p>}
          </> : <div class="empty-panel">Choose a provider, or add a new usage page.</div>}
        </main>
      </div>
      {samplesDialogOpen && <div class="samples-dialog-backdrop">
        <section class="samples-dialog" role="dialog" aria-modal="true" aria-labelledby="samples-dialog-title">
          <h2 id="samples-dialog-title">Try sample providers?</h2>
          <p>以下のURLから、6サービス分のサンプル設定を取得します。</p>
          <code>{PROVIDERS_REGISTRY_URL}</code>
          <p>取得するのは表示名とURLパターンだけです。selector・Cookie・トークン・usage値は含まれません。登録後、各ページで追跡したい数値をteach-modeで教えてください。</p>
          {samplesError && <p class="samples-error" role="alert">{samplesError}</p>}
          <div class="samples-dialog-actions">
            <button disabled={samplesLoading} onClick={() => setSamplesDialogOpen(false)}>キャンセル</button>
            <button class="primary-button" disabled={samplesLoading} onClick={() => void importSamples()}>{samplesLoading ? '取得中…' : samplesError ? '再試行' : '取得する'}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

render(<OptionsApp />, document.getElementById('app')!);
