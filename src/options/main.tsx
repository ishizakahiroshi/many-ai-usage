import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DashboardResponse } from '../shared/messages';
import { ageLabel, formatMetric, remainingPercent, statusLabel } from '../shared/format';
import { fileToIconDataUrl } from '../shared/icon';
import type { ProviderConfig, ProviderMode, TaughtMetric } from '../shared/schema';
import {
  initI18n,
  listLocales,
  setStoredUiLocale,
  UI_LOCALE_STORAGE_KEY,
  type LocaleCatalog,
  type TranslateFn,
} from '../shared/i18n';
import { buildGitHubIssueUrl, buildReportBody, detectBrowser, githubOpenUserMessage } from '../shared/report';
import { fetchStarterPack, isSampleProviderId, parseStarterPackText, STARTER_PACK_URL, USAGE_GUIDE_URL } from '../shared/samples';
import { applyStarterProviders } from '../shared/storage';
import { obsLog, perfLog, perfNow } from '../shared/perf';
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

function requestedProviderId(): string | null {
  return new URLSearchParams(window.location.search).get('provider');
}

/** Pretty-print a taught metric for local diagnostics (browser-only; no secrets). */
function formatTrackJson(metric: TaughtMetric): string {
  return JSON.stringify(metric, null, 2);
}

function OptionsApp() {
  // Capture deep-link before strip effect / async reload can clear the query.
  const [bootProviderId] = useState<string | null>(() => requestedProviderId());
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(blankDraft());
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [samplesDialogOpen, setSamplesDialogOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('importStarter') === '1' || params.get('trySamples') === '1';
  });
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [samplesError, setSamplesError] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteLoading, setPasteLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(() => new URLSearchParams(window.location.search).get('report') === '1');
  const [reportTitle, setReportTitle] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [reportSteps, setReportSteps] = useState('');
  const [reportMessage, setReportMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [reportPreviewOpen, setReportPreviewOpen] = useState(false);
  const [copiedTrackId, setCopiedTrackId] = useState<string | null>(null);
  const [t, setT] = useState<TranslateFn | null>(null);
  const [locale, setLocale] = useState('en');
  const [catalog, setCatalog] = useState<LocaleCatalog | null>(null);

  const reload = () => {
    const startedAt = perfNow();
    obsLog('options.reload.start');
    void sendMessage<DashboardResponse>({ type: 'GET_DASHBOARD' })
      .then((next) => {
        setDashboard(next);
        if (selectedId == null) {
          // Prefer the provider deep-linked from popup Settings; fall back to first in list.
          const preferred = (bootProviderId && next.providers.find((provider) => provider.id === bootProviderId))
            || next.providers[0]
            || null;
          if (preferred) {
            setSelectedId(preferred.id);
            setDraft(draftFrom(preferred));
          }
        }
        if (selectedId && selectedId !== 'new' && !dirty) {
          const selected = next.providers.find((provider) => provider.id === selectedId);
          if (selected) setDraft(draftFrom(selected));
        }
        obsLog('options.reload.done', {
          providers: next.providers.length,
          ms: Math.round(perfNow() - startedAt),
        });
        perfLog('options.reload', startedAt, { providers: next.providers.length }, 30);
      })
      .catch((error: unknown) => {
        obsLog('options.reload.fail', {
          ms: Math.round(perfNow() - startedAt),
          error: error instanceof Error ? error.name : 'unknown',
        });
      });
  };
  const applyI18n = () => {
    void initI18n().then((i18n) => {
      setT(() => i18n.t);
      setLocale(i18n.locale);
      setCatalog(i18n.catalog);
      obsLog('options.i18n', { locale: i18n.locale });
    }).catch((error: unknown) => {
      obsLog('options.i18n.fail', { error: error instanceof Error ? error.name : 'unknown' });
      // Fallback: identity translator so keys are visible if packs fail to load.
      setT(() => (key: string) => key);
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    obsLog('options.boot', {
      hrefPath: window.location.pathname,
      importStarter: params.get('importStarter') === '1' || params.get('trySamples') === '1',
      hasProvider: Boolean(bootProviderId),
    });
    applyI18n();
    reload();
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Strip one-shot launch params so reload/bookmark does not keep forcing selection/dialog.
    if (params.has('trySamples') || params.has('importStarter') || params.has('provider') || params.has('report')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[UI_LOCALE_STORAGE_KEY]) {
        applyI18n();
        return;
      }
      obsLog('options.storage.onChanged', { keys: Object.keys(changes) });
      // Debounce: rapid multi-key writes (or any residual write storms) must not stack reloads.
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
  }, [selectedId, dirty]);

  const selectedProvider = useMemo(() => dashboard?.providers.find((provider) => provider.id === selectedId) ?? null, [dashboard, selectedId]);
  const selectedSnapshot = selectedProvider && dashboard ? dashboard.snapshots[selectedProvider.id] : null;
  const selectedState = selectedProvider && dashboard ? dashboard.runtimeStates[selectedProvider.id] : null;
  const showTrySamples = dashboard ? !dashboard.providers.some((provider) => isSampleProviderId(provider.id)) : false;

  const select = (id: string | 'new') => {
    if (!t) return;
    if (dirty && !window.confirm(t('options.discardConfirm'))) return;
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
    if (!t) return;
    if (!draft.displayName.trim()) return setMessage(t('options.msgNeedDisplayName'));
    if (!validUrl(draft.url)) return setMessage(t('options.msgNeedUrl'));
    const now = new Date().toISOString();
    const existing = selectedProvider;
    let granted = await permissionFor(draft.url);
    if (!granted || (existing && originChanged(existing.url, draft.url))) {
      setMessage(t('options.msgRequestingAccess'));
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
    setMessage(granted ? t('options.msgSavedOk') : t('options.msgSavedNoPerm'));
    reload();
  };

  const remove = async () => {
    if (!t || !selectedProvider || !window.confirm(t('options.deleteConfirm', { name: selectedProvider.displayName }))) return;
    await sendMessage({ type: 'DELETE_PROVIDER', providerId: selectedProvider.id });
    setSelectedId(null);
    setDirty(false);
    reload();
  };

  const allowSelected = async () => {
    if (!t || !selectedProvider) return;
    const granted = await requestPermission(draft.url || selectedProvider.url);
    await sendMessage({ type: 'SYNC_PERMISSION', providerId: selectedProvider.id, granted });
    setMessage(granted ? t('options.msgAccessGranted') : t('options.msgAccessDenied'));
    reload();
  };

  const trackSelected = async (metricId?: string, pickerMode: 'metrics' | 'reset' = 'metrics', resetFirst = false) => {
    if (!t || !selectedProvider) return;
    let granted = await permissionFor(selectedProvider.url);
    if (!granted) {
      granted = await requestPermission(selectedProvider.url);
      await sendMessage({ type: 'SYNC_PERMISSION', providerId: selectedProvider.id, granted });
    }
    if (!granted) {
      setMessage(t('options.msgTeachNeedAccess'));
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
    if (resetFirst) {
      setMessage(t('options.msgClearingTracks'));
      await sendMessage({ type: 'RESET_TEACH', providerId: selectedProvider.id });
      reload();
    }
    setMessage(pickerMode === 'reset' ? t('options.msgStartTeachReset') : t('options.msgStartTeach'));
    const result = await sendMessage<{ started?: boolean; reason?: string }>({
      type: 'START_PICKER',
      providerId: selectedProvider.id,
      metricId: resetFirst ? undefined : metricId,
      pickerMode,
    });
    if (result?.started === false) {
      const detail = result.reason === 'permission_denied'
        ? t('options.msgTeachPermDenied')
        : result.reason === 'content_script_unreachable'
          ? t('options.msgTeachUnreachable')
          : t('options.msgTeachFailed');
      setMessage(detail);
      return;
    }
    setMessage(pickerMode === 'reset' ? t('options.msgTeachReadyReset') : t('options.msgTeachReady'));
  };

  const onIconFile = async (file: File | null) => {
    if (!t || !file) return;
    try {
      const iconDataUrl = await fileToIconDataUrl(file);
      updateDraft('iconDataUrl', iconDataUrl);
      setMessage(t('options.msgIconReady'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('options.msgIconFail'));
    }
  };

  const clearIcon = () => {
    if (!t) return;
    updateDraft('iconDataUrl', undefined);
    setMessage(t('options.msgIconCleared'));
  };

  const renameMetric = async (metricId: string, currentLabel: string) => {
    if (!t || !selectedProvider) return;
    const label = window.prompt(t('options.metricNamePrompt'), currentLabel)?.trim();
    if (!label) return;
    await sendMessage({ type: 'RENAME_METRIC', providerId: selectedProvider.id, metricId, label });
    setMessage(t('options.msgMetricRenamed'));
    reload();
  };

  const removeMetric = async (metricId: string) => {
    if (!t || !selectedProvider) return;
    await sendMessage({ type: 'REMOVE_METRIC', providerId: selectedProvider.id, metricId });
    setMessage(t('options.msgMetricRemoved'));
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

  const formatImportMessage = (result: { added: string[]; skipped: string[]; replaced: string[] }): string => {
    if (result.added.length === 0 && result.replaced.length === 0) {
      return t?.('samples.alreadyRegistered') ?? 'Already registered';
    }
    const base = t?.('samples.added', {
      count: result.added.length + result.replaced.length,
      skipped: result.skipped.length,
    }) ?? `Added ${result.added.length}`;
    const next = t?.('samples.nextSteps') ?? '';
    return next ? `${base} ${next}` : base;
  };

  const mergeStarterProviders = async (providers: import('../shared/schema').ProviderConfig[]) => {
    let result = await applyStarterProviders(providers);
    if (result.added.length === 0 && result.skipped.length > 0 && result.replaced.length === 0) {
      const shouldReplace = window.confirm(
        t?.('samples.replaceConfirm', { count: result.skipped.length })
          ?? `Overwrite ${result.skipped.length} existing providers?`,
      );
      if (shouldReplace) {
        result = await applyStarterProviders(providers, { replaceExisting: true });
      }
    }
    return result;
  };

  const importSamples = async () => {
    setSamplesLoading(true);
    setSamplesError('');
    try {
      const providers = await fetchStarterPack();
      const result = await mergeStarterProviders(providers);
      setSamplesDialogOpen(false);
      setMessage(formatImportMessage(result));
      reload();
    } catch (error) {
      setSamplesError(error instanceof Error ? error.message : (t?.('samples.errorFallback') ?? 'Unable to import starter pack.'));
    } finally {
      setSamplesLoading(false);
    }
  };

  const importPastedStarter = async () => {
    if (!t) return;
    const text = pasteText.trim();
    if (!text) {
      setMessage(t('samples.pasteEmpty'));
      return;
    }
    setPasteLoading(true);
    setMessage('');
    try {
      const providers = await parseStarterPackText(text);
      const result = await mergeStarterProviders(providers);
      setPasteText('');
      setMessage(formatImportMessage(result));
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t('samples.errorFallback'));
    } finally {
      setPasteLoading(false);
    }
  };

  const openReport = () => {
    setReportMessage(null);
    setReportPreviewOpen(false);
    setReportOpen(true);
  };

  const extensionVersion = useMemo(() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return '0.1.0';
    }
  }, []);

  const reportBody = useMemo(() => {
    if (!dashboard || !t) return '';
    return buildReportBody({
      title: reportTitle,
      description: reportDescription,
      steps: reportSteps,
      extensionVersion,
      browser: detectBrowser(typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      providers: dashboard.providers.map((provider) => ({
        displayName: provider.displayName,
        status: dashboard.runtimeStates[provider.id]?.status ?? 'never_seen',
      })),
    }, t);
  }, [dashboard, reportTitle, reportDescription, reportSteps, extensionVersion, t]);

  const copyReport = async () => {
    if (!t) return;
    if (!reportTitle.trim() || !reportDescription.trim()) {
      setReportMessage({ kind: 'error', text: t('report.validationRequired') });
      return;
    }
    try {
      await navigator.clipboard.writeText(reportBody);
      setReportMessage({ kind: 'ok', text: t('report.copyOk') });
    } catch {
      setReportPreviewOpen(true);
      setReportMessage({ kind: 'error', text: t('report.copyFail') });
    }
  };

  const copyTrackJson = async (metric: TaughtMetric) => {
    try {
      await navigator.clipboard.writeText(formatTrackJson(metric));
      setCopiedTrackId(metric.metricId);
      window.setTimeout(() => {
        setCopiedTrackId((current) => (current === metric.metricId ? null : current));
      }, 1600);
    } catch {
      // Clipboard may be blocked; details panel already shows the JSON for manual copy.
      setCopiedTrackId(null);
    }
  };

  /** Always copy first — Issue Forms often drop ?body= prefill. */
  const openGitHubIssue = async () => {
    if (!t) return;
    if (!reportTitle.trim() || !reportDescription.trim()) {
      setReportMessage({ kind: 'error', text: t('report.validationRequired') });
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(reportBody);
      copied = true;
    } catch {
      copied = false;
      setReportPreviewOpen(true);
    }
    const { url, bodyIncluded } = buildGitHubIssueUrl(reportTitle, reportBody, t);
    setReportMessage({
      kind: copied ? 'ok' : 'error',
      text: githubOpenUserMessage(copied, bodyIncluded, t),
    });
    void chrome.tabs.create({ url, active: true });
  };

  if (!dashboard || !t) return <div class="options-loading">{t?.('common.loading') ?? 'Loading…'}</div>;
  const localeOptions = catalog ? listLocales(catalog) : [{ code: locale, label: locale }];
  return (
    <div class="options-shell">
      <header class="options-header">
        <div class="brand">
          <img class="app-icon" src={chrome.runtime.getURL('assets/icons/icon-192.png')} width={28} height={28} alt="" />
          <strong>many-ai-usage</strong>
          <span>{t('options.settingsTitle', { version: extensionVersion })}</span>
        </div>
        <div class="header-actions">
          <label class="locale-select-wrap">
            <span class="visually-hidden">{t('common.language')}</span>
            <select
              class="locale-select"
              value={locale}
              aria-label={t('common.language')}
              onChange={(event) => {
                void setStoredUiLocale(event.currentTarget.value).then(() => applyI18n());
              }}
            >
              {localeOptions.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </select>
          </label>
          <span class="privacy-note">{t('options.privacyNote')}</span>
        </div>
      </header>
      <div class="options-layout">
        <aside class="sidebar">
          <button class="add-button" onClick={() => select('new')}>{t('options.newProvider')}</button>
          {showTrySamples && <div class="samples-onboarding">
            <strong>{t('samples.onboardingTitle')}</strong>
            <span>{t('samples.onboardingBody')}</span>
            <button class="samples-button" onClick={openSamplesDialog}>{t('samples.trySamples')}</button>
            <a href={USAGE_GUIDE_URL} target="_blank" rel="noopener noreferrer">{t('usageGuide.link')}</a>
          </div>}
          <div class="sidebar-label">{t('options.registeredProviders')}</div>
          <div class="provider-sidebar-list">
            {dashboard.providers.map((provider) => {
              const state = dashboard.runtimeStates[provider.id];
              const snapshot = dashboard.snapshots[provider.id];
              const lowest = snapshot?.metrics.map(remainingPercent).filter((value): value is number => value != null).sort((a, b) => a - b)[0];
              const sub = lowest != null
                ? t('options.remainingPercent', { n: Math.round(lowest) })
                : state.status === 'needs_permission'
                  ? t('options.needsAccess')
                  : snapshot?.source === 'page_only'
                    ? t('options.tile')
                    : t('options.notCaptured');
              return <button key={provider.id} class={`sidebar-provider ${selectedId === provider.id ? 'selected' : ''}`} draggable onDragStart={() => setDraggedId(provider.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => draggedId && void reorder(draggedId, provider.id)} onClick={() => select(provider.id)}>
                <span class="drag-handle">☰</span>
                {provider.iconDataUrl
                  ? <img class="provider-icon" src={provider.iconDataUrl} alt="" aria-hidden="true" />
                  : <span class="provider-icon placeholder" aria-hidden="true" />}
                <span class="sidebar-provider-main"><strong>{provider.displayName}</strong><small>{sub}</small></span><span class={`sidebar-state ${state.status}`}>{state.status === 'needs_permission' ? t('sidebar.needsPermission') : snapshot?.source === 'page_only' ? t('options.tile') : ''}</span>
              </button>;
            })}
          </div>
          <div class="sidebar-footer">
            <button type="button" class="sidebar-starter-button" onClick={openSamplesDialog}>{t('samples.trySamples')}</button>
            <button type="button" class="report-link-button" onClick={openReport}>{t('report.link')}</button>
          </div>
        </aside>
        <main class="main-panel">
          <div class="panel-heading">
            <div><h1>{selectedId === 'new' ? t('options.newProviderHeading') : selectedProvider?.displayName ?? t('options.selectProvider')}</h1>{selectedProvider && <span class={`status-badge ${selectedState?.status}`}>{statusLabel(selectedState!, t)}</span>}</div>
            {selectedProvider && <span class="last-captured">{ageLabel(selectedSnapshot?.capturedAt ?? null, t)}</span>}
          </div>
          {selectedProvider && selectedState?.status === 'needs_permission' && <div class="permission-callout"><div><strong>{t('options.hostAccessRequired')}</strong><span>{t('options.hostAccessBody')}</span></div><div><button onClick={() => void allowSelected()}>{t('options.allowAccess')}</button><button class="danger-button" onClick={() => void remove()}>{t('common.delete')}</button></div></div>}
          {selectedId === 'new' || selectedProvider ? <>
            {selectedProvider && <section class="current-section"><div class="section-heading"><h2>{t('options.currentUsage')}</h2><div class="section-actions"><button onClick={() => void sendMessage({ type: 'REFRESH_PROVIDER', providerId: selectedProvider.id }).then(reload)}>{t('options.refreshNow')}</button><button onClick={() => void sendMessage({ type: 'OPEN_PROVIDER', providerId: selectedProvider.id })}>{t('options.openPage')}</button></div></div>{selectedSnapshot?.metrics.length ? <div class="metric-grid">{selectedSnapshot.metrics.map((metric) => <div class="metric-card" key={metric.id}><span>{metric.window.label}</span><strong>{formatMetric(metric)}</strong><small>{metric.label}</small></div>)}</div> : <div class="no-metrics">{t('options.noMetrics')}</div>}</section>}
            <section class="form-section">
              <div class="section-heading"><h2>{t('options.providerSettings')}</h2><span>{t('options.providerSettingsHint')}</span></div>
              <label>{t('options.displayName')}<input value={draft.displayName} onInput={(event) => updateDraft('displayName', event.currentTarget.value)} placeholder={t('options.displayNamePlaceholder')} /></label>
              <label>{t('options.usagePageUrl')}<input value={draft.url} onInput={(event) => updateDraft('url', event.currentTarget.value)} placeholder={t('options.usagePageUrlPlaceholder')} /></label>
              <p class="help-text">{t('options.urlHelp')}</p>
              <div class="icon-field">
                <div class="icon-preview-wrap">
                  {draft.iconDataUrl
                    ? <img class="icon-preview" src={draft.iconDataUrl} alt="" />
                    : <span class="icon-preview placeholder" aria-hidden="true" />}
                  <div>
                    <strong>{t('options.customIcon')}</strong>
                    <p class="help-text">{t('options.customIconHelp')}</p>
                    <div class="icon-actions">
                      <label class="file-button">
                        {t('options.chooseImage')}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(event) => {
                          const input = event.currentTarget;
                          void onIconFile(input.files?.[0] ?? null).finally(() => { input.value = ''; });
                        }} />
                      </label>
                      <button type="button" disabled={!draft.iconDataUrl} onClick={clearIcon}>{t('common.remove')}</button>
                    </div>
                  </div>
                </div>
              </div>
              <div class="form-grid">
                <label>{t('options.refreshInterval')}<input type="number" min="3" max="240" value={draft.refreshIntervalMinutes} onInput={(event) => updateDraft('refreshIntervalMinutes', Number(event.currentTarget.value))} /></label>
                <label>{t('options.mode')}<select value={draft.mode} onChange={(event) => updateDraft('mode', event.currentTarget.value as ProviderMode)}><option value="auto">{t('options.modeAuto')}</option><option value="taught">{t('options.modeTaught')}</option><option value="embed">{t('options.modeEmbed')}</option></select></label>
              </div>
              {selectedProvider && <div class="teach-panel"><div><strong>{t('options.teachTitle')}</strong><p class="help-text">{t('options.teachHelp')}</p></div><div class="teach-panel-actions"><button class="primary-button" onClick={() => void trackSelected()}>{t('options.trackElement')}</button>{selectedProvider.metrics.length > 0 && <button class="primary-button" onClick={() => void trackSelected(undefined, 'metrics', true)}>{t('options.fixTracking')}</button>}</div></div>}
              {selectedProvider && selectedProvider.metrics.length > 0 && <div class="taught-metrics">
                <strong>{t('options.trackedElements')}</strong>
                {selectedProvider.metrics.map((metric) => {
                  const lastValue = selectedSnapshot?.metrics.find((item) => item.id === metric.metricId);
                  const unread = !lastValue;
                  const trackJson = formatTrackJson(metric);
                  return (
                    <div class="taught-metric" key={metric.metricId}>
                      <div class="taught-metric-row">
                        <span>
                          <b>{metric.label}</b>
                          <small>{metric.windowLabel ?? '—'} · {metric.valueAnchor?.selectors[0] ?? t('options.noSelector')} · {t('options.lastRead', { value: lastValue ? formatMetric(lastValue) : t('options.notRead') })}</small>
                          {unread ? <small class="teach-unread-hint">{t('options.brokenTrack')}</small> : null}
                        </span>
                        <span class="metric-actions">
                          <button type="button" onClick={() => void renameMetric(metric.metricId, metric.label)}>{t('common.rename')}</button>
                          <button type="button" onClick={() => void trackSelected(metric.metricId)}>{t('options.reteachValue')}</button>
                          <button type="button" onClick={() => void trackSelected(metric.metricId, 'reset')}>{t('options.reteachReset')}</button>
                          <button type="button" onClick={() => void removeMetric(metric.metricId)}>{t('common.delete')}</button>
                        </span>
                      </div>
                      <details class="track-json">
                        <summary>{t('options.trackJsonSummary')}</summary>
                        <div class="track-json-toolbar">
                          <button type="button" onClick={() => void copyTrackJson(metric)}>
                            {copiedTrackId === metric.metricId ? t('options.trackJsonCopied') : t('options.trackJsonCopy')}
                          </button>
                        </div>
                        <pre>{trackJson}</pre>
                      </details>
                    </div>
                  );
                })}
              </div>}
            </section>
            {selectedProvider && <section class="diagnostic-section"><div class="section-heading"><h2>{t('options.diagnostics')}</h2><span>{selectedState?.errorLabel ?? t('options.evidenceSummary')}</span></div><dl class="diagnostic-grid"><dt>{t('options.diagStatus')}</dt><dd>{selectedState ? statusLabel(selectedState, t) : t('status.never_seen')}</dd><dt>{t('options.diagSource')}</dt><dd>{selectedSnapshot?.source ?? '—'}</dd><dt>{t('options.diagConfidence')}</dt><dd>{selectedState?.confidence ?? 'none'}</dd><dt>{t('options.diagLastCaptured')}</dt><dd>{ageLabel(selectedSnapshot?.capturedAt ?? null, t)}</dd><dt>{t('options.diagStaleThreshold')}</dt><dd>{t('options.minutesUnit', { n: draft.refreshIntervalMinutes * 2 })}</dd><dt>{t('options.diagEvidence')}</dt><dd>{selectedState?.evidenceSummary.join(' · ') || '—'}</dd></dl></section>}
            <div class="form-footer"><button class="danger-button" disabled={!selectedProvider} onClick={() => void remove()}>{t('common.delete')}</button><div><button disabled={!dirty} onClick={() => { if (selectedProvider) setDraft(draftFrom(selectedProvider)); else setDraft(blankDraft(dashboard.providers.length)); setDirty(false); setMessage(''); }}>{t('options.discardChanges')}</button><button class="primary-button" disabled={!dirty} onClick={() => void save()}>{t('common.save')}</button></div></div>
            {message && <p class="save-message" role="status">{message}</p>}
          </> : <div class="empty-panel">{t('options.emptyPanel')}</div>}
          <details class="starter-paste">
            <summary>{t('samples.pasteSummary')}</summary>
            <p class="help-text">{t('samples.pasteHelp')}</p>
            <textarea
              class="starter-paste-input"
              rows={8}
              value={pasteText}
              placeholder={t('samples.pastePlaceholder')}
              onInput={(event) => setPasteText(event.currentTarget.value)}
              spellcheck={false}
            />
            <div class="starter-paste-actions">
              <button
                type="button"
                class="primary-button"
                disabled={pasteLoading}
                onClick={() => void importPastedStarter()}
              >
                {pasteLoading ? t('samples.fetching') : t('samples.pasteImport')}
              </button>
            </div>
          </details>
          {message && !selectedProvider && selectedId !== 'new' && <p class="save-message" role="status">{message}</p>}
        </main>
      </div>
      {samplesDialogOpen && <div class="samples-dialog-backdrop">
        <section class="samples-dialog" role="dialog" aria-modal="true" aria-labelledby="samples-dialog-title">
          <h2 id="samples-dialog-title">{t('samples.dialogTitle')}</h2>
          <p>{t('samples.dialogLead')}</p>
          <code>{STARTER_PACK_URL}</code>
          <p>{t('samples.dialogBody')}</p>
          {samplesError && <p class="samples-error" role="alert">{samplesError}</p>}
          <div class="samples-dialog-actions">
            <button disabled={samplesLoading} onClick={() => setSamplesDialogOpen(false)}>{t('common.cancel')}</button>
            <button class="primary-button" disabled={samplesLoading} onClick={() => void importSamples()}>{samplesLoading ? t('samples.fetching') : samplesError ? t('common.retry') : t('samples.fetch')}</button>
          </div>
        </section>
      </div>}
      {reportOpen && <div class="samples-dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setReportOpen(false); }}>
        <section class="samples-dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-dialog-title">
          <h2 id="report-dialog-title">{t('report.dialogTitle')}</h2>
          <p class="report-privacy-note">{t('report.privacyNote')}</p>
          <label class="report-field">{t('report.titleLabel')}
            <input value={reportTitle} onInput={(event) => { setReportTitle(event.currentTarget.value); setReportMessage(null); }} placeholder={t('report.titlePlaceholder')} maxLength={120} />
          </label>
          <label class="report-field">{t('report.descriptionLabel')}
            <textarea value={reportDescription} onInput={(event) => { setReportDescription(event.currentTarget.value); setReportMessage(null); }} rows={4} placeholder={t('report.descriptionPlaceholder')} maxLength={2000} />
          </label>
          <label class="report-field">{t('report.stepsLabel')}
            <textarea value={reportSteps} onInput={(event) => { setReportSteps(event.currentTarget.value); setReportMessage(null); }} rows={3} placeholder={t('report.stepsPlaceholder')} maxLength={2000} />
          </label>
          <p class="help-text">{t('report.screenshotHint')}</p>
          <details class="report-preview" open={reportPreviewOpen || undefined} onToggle={(event) => setReportPreviewOpen((event.currentTarget as HTMLDetailsElement).open)}>
            <summary>{t('report.previewSummary')}</summary>
            <pre>{reportBody}</pre>
          </details>
          {reportMessage && <p class={`report-status ${reportMessage.kind === 'error' ? 'is-error' : ''}`} role="status">{reportMessage.text}</p>}
          <div class="samples-dialog-actions report-actions">
            <button type="button" onClick={() => setReportOpen(false)}>{t('common.close')}</button>
            <button type="button" onClick={() => void copyReport()}>{t('report.copy')}</button>
            <button type="button" class="primary-button" onClick={() => void openGitHubIssue()}>{t('report.openGitHub')}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}

render(<OptionsApp />, document.getElementById('app')!);
