import { describe, expect, it } from 'vitest';
import {
  buildGitHubIssueUrl,
  buildReportBody,
  detectBrowser,
  githubOpenUserMessage,
  GITHUB_NEW_ISSUE_BASE,
  MAX_GITHUB_ISSUE_URL_LENGTH,
} from '../src/shared/report';

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

  it('includes user text and non-secret environment fields', () => {
    const body = buildReportBody(base);
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
  });

  it('never embeds secret-like auto fields (only displayName + status + user text)', () => {
    const body = buildReportBody({
      ...base,
      // Malicious-looking strings in user-controlled title must stay user text only;
      // auto section must still list only displayName + status.
      title: 'UI freeze (not a token leak)',
      providers: [{ displayName: 'Synthetic AI', status: 'error' }],
    });
    // Contract: auto-filled section has no URL / usage numbers / auth material.
    expect(body).toContain('Synthetic AI: error');
    expect(body).not.toMatch(/Authorization:/i);
    expect(body).not.toMatch(/Bearer /);
    expect(body).not.toMatch(/innerHTML|outerHTML/);
    expect(body).not.toMatch(/https?:\/\/[^\s]+/);
    // Keys that must never appear as auto-filled lines
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
    });
    // displayName is user-controlled and may echo secrets — still must not invent secret field labels.
    const envSection = body.split('## Environment (auto-filled, non-secret)')[1]?.split('## Notes')[0] ?? '';
    expect(envSection).toMatch(/^- Extension: many-ai-usage v/m);
    expect(envSection).toMatch(/^- Browser: /m);
    expect(envSection).toMatch(/^- Providers: /m);
    expect(envSection).toMatch(/^- Status summary:/m);
    expect(envSection).not.toMatch(/^- Cookie:/m);
    expect(envSection).not.toMatch(/^- URL:/m);
    expect(envSection).not.toMatch(/^- Usage value:/m);
    expect(envSection).not.toMatch(/Authorization:/i);
    // Snapshot of auto field keys only (values may contain user rename noise).
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
    });
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
    });
    const result = buildGitHubIssueUrl('Short', body);
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
    });
    const result = buildGitHubIssueUrl('Long report', body);
    expect(result.bodyIncluded).toBe(false);
    expect(result.url).toContain('title=');
    expect(result.url).not.toContain('body=');
    expect(result.url.length).toBeLessThan(MAX_GITHUB_ISSUE_URL_LENGTH);
  });
});

describe('githubOpenUserMessage', () => {
  it('always steers users to paste when copy succeeded (Issue Form safe)', () => {
    expect(githubOpenUserMessage(true, true)).toMatch(/コピー/);
    expect(githubOpenUserMessage(true, true)).toMatch(/貼/);
    expect(githubOpenUserMessage(true, false)).toMatch(/コピー済み/);
  });

  it('asks for manual copy when clipboard failed', () => {
    expect(githubOpenUserMessage(false, true)).toMatch(/コピーに失敗/);
    expect(githubOpenUserMessage(false, false)).toMatch(/手動でコピー/);
  });
});
