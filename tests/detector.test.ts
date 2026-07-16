import { describe, expect, it } from 'vitest';
import { detectUsage } from '../src/content/detector';

function page(body: string): Document {
  document.body.innerHTML = body;
  return document;
}

describe('local usage detector', () => {
  it('normalizes a remaining percentage with window evidence', () => {
    const snapshot = detectUsage(page('<section><h2>Weekly quota</h2><p>70% remaining</p><p>Resets in 5h</p></section>'), 'fixture:weekly', 'Synthetic AI', Date.parse('2026-07-14T00:00:00.000Z'));
    expect(snapshot.source).toBe('dom');
    expect(snapshot.metrics[0].remaining).toBe(70);
    expect(snapshot.metrics[0].window.label.toLowerCase()).toContain('week');
  });

  it('reads progress and used-total evidence', () => {
    const snapshot = detectUsage(page('<div aria-label="Monthly requests"><progress value="40" max="100"></progress></div><p>120 / 500 requests weekly</p>'), 'fixture:mixed', 'Synthetic AI');
    expect(snapshot.source).toBe('dom');
    expect(snapshot.metrics.length).toBeGreaterThanOrEqual(2);
  });

  it('does not promote an unrelated navigation percentage', () => {
    const snapshot = detectUsage(page('<nav><a>50% off pricing</a></nav>'), 'fixture:noise', 'Synthetic AI');
    expect(snapshot.source).toBe('page_only');
    expect(snapshot.metrics).toHaveLength(0);
  });

  it('falls back to page-only when confidence is below the threshold', () => {
    const snapshot = detectUsage(page('<p>Try our 42% off banner</p>'), 'fixture:tile', 'Synthetic AI');
    expect(snapshot.source).toBe('page_only');
    expect(snapshot.warningReason).toContain('No usage evidence');
  });

  it('picks up a Japanese remaining percentage with quota and reset context', () => {
    const snapshot = detectUsage(page('<section><h2>週間利用上限</h2><p>53% 残り</p><p>リセット: 2026/07/20</p></section>'), 'fixture:jp-percent', 'Synthetic AI', Date.parse('2026-07-14T00:00:00.000Z'));
    expect(snapshot.source).toBe('dom');
    expect(snapshot.metrics.length).toBeGreaterThan(0);
    expect(snapshot.metrics[0].remaining).toBe(53);
  });

  it('picks up Codex-shaped nested Japanese percentage (Tailwind card structure)', () => {
    // 実 Codex 利用状況ページの DOM を DevTools で確認した shape を合成データに落としたもの
    const html = '<article><header class="flex flex-col gap-1"><div>週間利用上限</div><div class="text-token-text-primary flex items-baseline"><span class="text-2xl font-semibold">32%</span> 残り</div></header><div>リセット：2026/07/20 10:30</div></article>';
    const snapshot = detectUsage(page(html), 'fixture:codex-shape', 'Synthetic AI', Date.parse('2026-07-14T00:00:00.000Z'));
    expect(snapshot.source).toBe('dom');
    expect(snapshot.metrics.length).toBeGreaterThan(0);
    expect(snapshot.metrics[0].remaining).toBe(32);
  });

  it('does not turn a four-digit year or reset date into a usage candidate', () => {
    const snapshot = detectUsage(page('<section><h2>更新予定</h2><p>リセット: 2026/07/22</p></section>'), 'fixture:reset-only', 'Synthetic AI');
    expect(snapshot.source).toBe('page_only');
    expect(snapshot.metrics).toHaveLength(0);
  });

  it('keeps percent and unit-bearing quota candidates ahead of reset-date noise', () => {
    const snapshot = detectUsage(page('<section><h2>Weekly quota</h2><p>62% remaining</p><p>18 / 40 requests used</p><p>Resets: 2026/07/22</p></section>'), 'fixture:priority', 'Synthetic AI');
    expect(snapshot.metrics[0].unit).toBe('percent');
    expect(snapshot.metrics.some((metric) => metric.unit === 'requests' && metric.used === 18 && metric.total === 40)).toBe(true);
  });
});
