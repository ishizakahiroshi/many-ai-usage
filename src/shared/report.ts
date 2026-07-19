/** Non-secret bug-report helpers for options UI and GitHub Issues. */

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
 */
export function buildReportBody(input: ReportInput): string {
  const title = input.title.trim() || '(no title)';
  const description = input.description.trim() || '(not provided)';
  const steps = input.steps?.trim() || '(not provided)';
  const statusLines = input.providers.length > 0
    ? input.providers.map((provider) => `  - ${provider.displayName}: ${provider.status}`).join('\n')
    : '  - (none registered)';

  return [
    '## Summary',
    title,
    '',
    '## What happened',
    description,
    '',
    '## Steps to reproduce',
    steps,
    '',
    '## Environment (auto-filled, non-secret)',
    `- Extension: many-ai-usage v${input.extensionVersion}`,
    `- Browser: ${input.browser}`,
    `- Providers: ${input.providers.length}`,
    '- Status summary:',
    statusLines,
    '',
    '## Notes',
    '- Do not paste cookies, tokens, account emails, raw HTML, or real usage numbers.',
    '- Screenshots: mask personal data before attaching.',
    '',
  ].join('\n');
}

export interface GitHubIssueOpenResult {
  url: string;
  bodyIncluded: boolean;
}

/** Build issues/new URL; drop body when the full URL would be too long. */
export function buildGitHubIssueUrl(title: string, body: string): GitHubIssueOpenResult {
  const safeTitle = title.trim() || 'Bug report';
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
export function githubOpenUserMessage(copied: boolean, bodyIncluded: boolean): string {
  if (copied && bodyIncluded) {
    return 'レポートをコピーして GitHub を開きました。Issue フォームでは Environment 欄などに貼り付けてください（本文の自動入力が効かないことがあります）。';
  }
  if (copied && !bodyIncluded) {
    return '本文が長いためタイトルのみ開きます。本文はクリップボードにコピー済みなので Issue に貼り付けてください。';
  }
  if (!copied && bodyIncluded) {
    return 'コピーに失敗しました。下の文面を手動でコピーしてから、開いた Issue に貼り付けてください。';
  }
  return 'コピーに失敗しました。本文が長いためタイトルのみ開きます。下の文面を手動でコピーして Issue に貼り付けてください。';
}
