import { describe, expect, it } from 'vitest';
import en from '../src/locales/en.json';
import ja from '../src/locales/ja.json';
import { createTranslator, type MessageTable } from '../src/shared/i18n';
import {
  buildGitHubIssueUrl,
  buildReportBody,
  detectBrowser,
  githubOpenUserMessage,
  GITHUB_NEW_ISSUE_BASE,
  MAX_GITHUB_ISSUE_URL_LENGTH,
} from '../src/shared/report';

const tEn = createTranslator(en as MessageTable);
const tJa = createTranslator(ja as MessageTable, en as MessageTable);

describe('detectBrowser', () => {
  it('detects Firefox, Chrome, and Other', () => {
    expect(detectBrowser('Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0')).toBe('Firefox');
    expect(detectBrowser('Mozilla/5.0 Chrome/126.0.0.0 Safari/537.36')).toBe('Chrome');
    expect(detectBrowser('Mozilla/5.0 Edg/126.0.0.0')).toBe('Other');
    expect(detectBrowser('SomeRareBrowser/1.0')).toBe('Other');
  });
});

describe('buildReportBody', () => {
  const base = {
    title: 'Picker fails after page change',
    description: 'Re-teach opens but Done does not save.',
    steps: '1. Open settings\n2. Click Fix tracking',
    extensionVersion: '0.1.0',
    browser: 'Chrome',
    providers: [
      { displayName: 'Synthetic AI', status: 'needs_teaching' },
      { displayName: 'Example Bot', status: 'ok' },
    ],
  };

  it('includes user text and non-secret environment fields (en pack)', () => {
    const body = buildReportBody(base, tEn);
    expect(body).toContain('## Summary');
    expect(body).toContain('Picker fails after page change');
    expect(body).toContain('## What happened');
    expect(body).toContain('Re-teach opens but Done does not save.');
    expect(body).toContain('## Steps to reproduce');
    expect(body).toContain('1. Open settings');
    expect(body).toContain('many-ai-usage v0.1.0');
    expect(body).toContain('Browser: Chrome');
    expect(body).toContain('Providers: 2');
    expect(body).toContain('- Synthetic AI: needs_teaching');
    expect(body).toContain('- Example Bot: ok');
    expect(body).toContain('Do not paste cookies');
    expect(body).toContain('Screenshots: attach on the GitHub Issue yourself');
    expect(body).toContain('The extension cannot upload images');
  });

  it('never embeds secret-like auto fields (only displayName + status + user text)', () => {
    const body = buildReportBody({
      ...base,
      title: 'UI freeze (not a token leak)',
      providers: [{ displayName: 'Synthetic AI', status: 'error' }],
    }, tEn);
    expect(body).toContain('Synthetic AI: error');
    expect(body).not.toMatch(/Authorization:/i);
    expect(body).not.toMatch(/Bearer /);
    expect(body).not.toMatch(/innerHTML|outerHTML/);
    expect(body).not.toMatch(/https?:\/\/[^\s]+/);
    expect(body).not.toMatch(/^- Cookie:/m);
    expect(body).not.toMatch(/^- URL:/m);
    expect(body).not.toMatch(/^- Usage value:/m);
  });

  it('allowlists environment lines (no url / cookie / usage keys even if displayName is noisy)', () => {
    const body = buildReportBody({
      ...base,
      title: 'Rename check',
      description: 'User free text may mention tokens; that is intentional paste risk.',
      providers: [
        {
          displayName: 'https://evil.example/path?token=abc',
          status: 'ok',
        },
      ],
    }, tEn);
    const envSection = body.split('## Environment (auto-filled, non-secret)')[1]?.split('## Notes')[0] ?? '';
    expect(envSection).toMatch(/^- Extension: many-ai-usage v/m);
    expect(envSection).toMatch(/^- Browser: /m);
    expect(envSection).toMatch(/^- Providers: /m);
    expect(envSection).toMatch(/^- Status summary:/m);
    expect(envSection).not.toMatch(/^- Cookie:/m);
    expect(envSection).not.toMatch(/^- URL:/m);
    expect(envSection).not.toMatch(/^- Usage value:/m);
    expect(envSection).not.toMatch(/Authorization:/i);
    const autoKeys = [...envSection.matchAll(/^- ([^:\n]+):/gm)].map((match) => match[1]);
    expect(autoKeys).toEqual(['Extension', 'Browser', 'Providers', 'Status summary']);
  });

  it('uses placeholders for empty optional fields and zero providers', () => {
    const body = buildReportBody({
      title: '  ',
      description: '',
      extensionVersion: '0.1.0',
      browser: 'Firefox',
      providers: [],
    }, tEn);
    expect(body).toContain('(no title)');
    expect(body).toContain('(not provided)');
    expect(body).toContain('Providers: 0');
    expect(body).toContain('(none registered)');
  });
});

describe('buildGitHubIssueUrl', () => {
  it('includes title and body when under the length cap', () => {
    const body = buildReportBody({
      title: 'Short',
      description: 'Brief issue',
      extensionVersion: '0.1.0',
      browser: 'Chrome',
      providers: [{ displayName: 'A', status: 'ok' }],
    }, tEn);
    const result = buildGitHubIssueUrl('Short', body, tEn);
    expect(result.bodyIncluded).toBe(true);
    expect(result.url.startsWith(GITHUB_NEW_ISSUE_BASE)).toBe(true);
    expect(result.url).toContain('title=');
    expect(result.url).toContain('body=');
    expect(result.url.length).toBeLessThanOrEqual(MAX_GITHUB_ISSUE_URL_LENGTH);
  });

  it('falls back to title-only when the prefilled URL would be too long', () => {
    const longDescription = 'x'.repeat(4000);
    const body = buildReportBody({
      title: 'Long report',
      description: longDescription,
      steps: 'y'.repeat(1000),
      extensionVersion: '0.1.0',
      browser: 'Chrome',
      providers: Array.from({ length: 20 }, (_, i) => ({
        displayName: `Provider ${i}`,
        status: 'needs_permission',
      })),
    }, tEn);
    const result = buildGitHubIssueUrl('Long report', body, tEn);
    expect(result.bodyIncluded).toBe(false);
    expect(result.url).toContain('title=');
    expect(result.url).not.toContain('body=');
    expect(result.url.length).toBeLessThan(MAX_GITHUB_ISSUE_URL_LENGTH);
  });
});

describe('githubOpenUserMessage', () => {
  it('uses Japanese pack strings when t is ja', () => {
    expect(githubOpenUserMessage(true, true, tJa)).toMatch(/コピー/);
    expect(githubOpenUserMessage(true, true, tJa)).toMatch(/貼/);
    expect(githubOpenUserMessage(true, false, tJa)).toMatch(/コピー済み/);
    expect(githubOpenUserMessage(true, true, tJa)).toMatch(/スクショは Issue 画面で自分で貼り付け/);
  });

  it('uses English pack strings when t is en', () => {
    expect(githubOpenUserMessage(true, true, tEn)).toMatch(/Copied the report/);
    expect(githubOpenUserMessage(false, true, tEn)).toMatch(/Copy failed/);
    expect(githubOpenUserMessage(true, true, tEn)).toMatch(/Attach screenshots yourself/);
  });
});
