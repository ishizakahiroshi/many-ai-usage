import type { AnchorFingerprint, NormalizedSnapshot, ProviderConfig, TaughtMetric } from './schema';

/** 'account' teaches which signed-in account a page belongs to (multi-account providers). */
export type PickerMode = 'metrics' | 'reset' | 'account';

export type RuntimeMessage =
  | { type: 'GET_DASHBOARD' }
  | { type: 'GET_PROVIDER_CONTEXT'; url: string }
  | { type: 'PING' }
  | { type: 'CAPTURE_RESULT'; providerId: string; snapshot: NormalizedSnapshot }
  | { type: 'CAPTURE_FAILURE'; providerId: string; reason: string }
  /**
   * providerId pins the capture to one entry. Several providers can share a usage URL
   * (multi-account), and without it a refresh of the second entry used to overwrite the first.
   */
  | { type: 'CAPTURE_NOW'; force?: boolean; providerId?: string }
  /** Ask the background worker which multi-account entry the page currently shows. */
  | { type: 'RESOLVE_ACCOUNT'; readings: Array<{ providerId: string; text: string }> }
  /** Store where the account identity sits. The text is hashed in the worker and never stored raw. */
  | { type: 'SAVE_ACCOUNT_ANCHOR'; providerId: string; accountAnchor: AnchorFingerprint; text: string }
  | { type: 'REFRESH_PROVIDER'; providerId: string }
  /** Re-read every permitted provider when the user explicitly refreshes the dashboard. */
  | { type: 'REFRESH_DASHBOARD' }
  | { type: 'OPEN_PROVIDER'; providerId: string }
  | { type: 'OPEN_OPTIONS'; providerId?: string }
  | { type: 'REQUEST_PERMISSION'; providerId: string }
  | { type: 'SYNC_PERMISSION'; providerId: string; granted: boolean }
  | { type: 'UPSERT_PROVIDER'; provider: ProviderConfig; permissionGranted: boolean }
  | { type: 'DELETE_PROVIDER'; providerId: string }
  | { type: 'REORDER_PROVIDERS'; ids: string[] }
  | { type: 'START_PICKER'; providerId: string; metricId?: string; pickerMode?: PickerMode }
  | {
    type: 'SAVE_METRIC';
    providerId: string;
    metric: TaughtMetric;
    liveRead?: {
      value: number | null;
      used: number | null;
      remaining: number | null;
      total: number | null;
      unit: import('./schema').MetricUnit;
      evidence: string;
      semanticSignals: string[];
      /** Teach-time nearby reset (Grok「2026年7月24日…にリセット」) so Done keeps it without re-capture. */
      resetLabel?: string | null;
      resetAt?: string | null;
    };
  }
  | { type: 'SAVE_RESET_ANCHOR'; providerId: string; metricId: string; resetAnchor: AnchorFingerprint }
  | { type: 'RENAME_METRIC'; providerId: string; metricId: string; label: string }
  | { type: 'REMOVE_METRIC'; providerId: string; metricId: string }
  /** Clear all taught metrics and failure counters so the user can start teach from a clean slate. */
  | { type: 'RESET_TEACH'; providerId: string }
  | { type: 'DONE_TEACH'; providerId: string }
  | { type: 'CANCEL_TEACH'; providerId: string };

export interface ProviderContext {
  provider: ProviderConfig;
  permissionGranted: boolean;
  /**
   * Every provider registered for this URL (container-filtered when the browser reports one).
   * Two or more means the same service is registered with several accounts, and the content
   * script has to resolve which one the page currently shows before writing a snapshot.
   */
  candidates: ProviderConfig[];
}

export interface DashboardResponse {
  providers: ProviderConfig[];
  snapshots: Record<string, NormalizedSnapshot | null>;
  runtimeStates: Record<string, import('./schema').ProviderRuntimeState>;
}
