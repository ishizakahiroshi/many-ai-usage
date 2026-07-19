/** Non-secret bug-report helpers for options UI and GitHub Issues. */

import type { TranslateFn } from './i18n';

export const GITHUB_NEW_ISSUE_BASE = 'https://github.com/ishizakahiroshi/many-ai-usage/issues/new';

/** Soft cap so title+body prefill stays usable in browsers/GitHub. */
export const MAX_GITHUB_ISSUE_URL_LENGTH = 1800;

export interface ReportProviderStatus {
  displayName: string;
  status: string;
}

export interface ReportInput {
  title: string;
  description: string;
  steps?: string;
  extensionVersion: string;
  browser: string;
  providers: ReportProviderStatus[];
}

export type BrowserKind = 'Chrome' | 'Firefox' | 'Other';

/** Coarse browser label only — never include the full user-agent string by default. */
export function detectBrowser(userAgent: string): BrowserKind {
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  // Edge/Opera are Chromium; treat as Other so reviewers see "not pure Chrome".
  if (/Edg\//i.test(userAgent) || /OPR\//i.test(userAgent)) return 'Other';
  if (/Chrome\//i.test(userAgent) || /Chromium\//i.test(userAgent)) return 'Chrome';
  return 'Other';
}

/**
 * Build a plain-text report body for clipboard and GitHub Issue body.
 * Must never include cookies, tokens, raw HTML, real usage numbers, or provider URLs.
 * Section labels come from the active language pack via `t`.
 */
export function buildReportBody(input: ReportInput, t: TranslateFn): string {
  const title = input.title.trim() || t('reportBody.noTitle');
  const description = input.description.trim() || t('reportBody.notProvided');
  const steps = input.steps?.trim() || t('reportBody.notProvided');
  const statusLines = input.providers.length > 0
    ? input.providers
      .map((provider) => t('reportBody.providerLine', { name: provider.displayName, status: provider.status }))
      .join('\n')
    : t('reportBody.noneRegistered');

  return [
    t('reportBody.summary'),
    title,
    '',
    t('reportBody.whatHappened'),
    description,
    '',
    t('reportBody.steps'),
    steps,
    '',
    t('reportBody.environment'),
    t('reportBody.extension', { version: input.extensionVersion }),
    t('reportBody.browser', { browser: input.browser }),
    t('reportBody.providers', { count: input.providers.length }),
    t('reportBody.statusSummary'),
    statusLines,
    '',
    t('reportBody.notes'),
    t('reportBody.noteSecrets'),
    t('reportBody.noteScreenshots'),
    '',
  ].join('\n');
}

export interface GitHubIssueOpenResult {
  url: string;
  bodyIncluded: boolean;
}

/** Build issues/new URL; drop body when the full URL would be too long. */
export function buildGitHubIssueUrl(title: string, body: string, t?: TranslateFn): GitHubIssueOpenResult {
  const safeTitle = title.trim() || (t ? t('reportBody.defaultIssueTitle') : 'Bug report');
  const withBody = `${GITHUB_NEW_ISSUE_BASE}?title=${encodeURIComponent(safeTitle)}&body=${encodeURIComponent(body)}`;
  if (withBody.length <= MAX_GITHUB_ISSUE_URL_LENGTH) {
    return { url: withBody, bodyIncluded: true };
  }
  return {
    url: `${GITHUB_NEW_ISSUE_BASE}?title=${encodeURIComponent(safeTitle)}`,
    bodyIncluded: false,
  };
}

/**
 * User-facing message after always-copy + open GitHub.
 * Issue Forms often ignore ?body= prefill, so clipboard is the reliable path.
 */
export function githubOpenUserMessage(copied: boolean, bodyIncluded: boolean, t: TranslateFn): string {
  const screenshotHint = t('report.screenshotHintShort');
  if (copied && bodyIncluded) return t('report.githubCopiedWithBody', { screenshotHint });
  if (copied && !bodyIncluded) return t('report.githubCopiedTitleOnly', { screenshotHint });
  if (!copied && bodyIncluded) return t('report.githubCopyFailWithBody', { screenshotHint });
  return t('report.githubCopyFailTitleOnly', { screenshotHint });
}
