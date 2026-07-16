import type { AnchorFingerprint, NormalizedSnapshot, ProviderConfig, TaughtMetric } from './schema';

export type RuntimeMessage =
  | { type: 'GET_DASHBOARD' }
  | { type: 'GET_PROVIDER_CONTEXT'; url: string }
  | { type: 'CAPTURE_RESULT'; providerId: string; snapshot: NormalizedSnapshot }
  | { type: 'CAPTURE_FAILURE'; providerId: string; reason: string }
  | { type: 'CAPTURE_NOW'; force?: boolean }
  | { type: 'REFRESH_PROVIDER'; providerId: string }
  | { type: 'OPEN_PROVIDER'; providerId: string }
  | { type: 'REQUEST_PERMISSION'; providerId: string }
  | { type: 'SYNC_PERMISSION'; providerId: string; granted: boolean }
  | { type: 'UPSERT_PROVIDER'; provider: ProviderConfig; permissionGranted: boolean }
  | { type: 'DELETE_PROVIDER'; providerId: string }
  | { type: 'REORDER_PROVIDERS'; ids: string[] }
  | { type: 'START_PICKER'; providerId: string; metricId?: string; pickerMode?: 'metrics' | 'reset' }
  | { type: 'SAVE_METRIC'; providerId: string; metric: TaughtMetric }
  | { type: 'SAVE_RESET_ANCHOR'; providerId: string; metricId: string; resetAnchor: AnchorFingerprint }
  | { type: 'RENAME_METRIC'; providerId: string; metricId: string; label: string }
  | { type: 'REMOVE_METRIC'; providerId: string; metricId: string }
  | { type: 'DONE_TEACH'; providerId: string }
  | { type: 'CANCEL_TEACH'; providerId: string };

export interface ProviderContext {
  provider: ProviderConfig;
  permissionGranted: boolean;
}

export interface DashboardResponse {
  providers: ProviderConfig[];
  snapshots: Record<string, NormalizedSnapshot | null>;
  runtimeStates: Record<string, import('./schema').ProviderRuntimeState>;
}
