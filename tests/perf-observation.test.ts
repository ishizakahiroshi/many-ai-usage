/**
 * Observation-only microbench (bug triage: freeze when adding Grok / heavy SPA pages).
 * Not a pass/fail gate for product correctness — records wall time on a large synthetic DOM.
 */
import { describe, expect, it } from 'vitest';
import { createAnchorFingerprint, findByFingerprint } from '../src/content/teach/selector';
import { inferResetAnchor } from '../src/content/teach/reset';
import { makeMetric, refineValueElement } from '../src/content/teach/picker';
import { extractValue } from '../src/content/teach/extract';

function buildLargeSpaDom(nodeCount: number, mode: 'deep-leaf' | 'usage-in-huge-card' = 'usage-in-huge-card'): HTMLElement {
  const root = document.createElement('div');
  root.id = 'spa-root';
  root.className = 'app-shell layout main-column common shared';
  // Huge card: clicking usage walks parents that still contain the whole filler tree
  // (matches chat SPAs where usage sits inside a large layout shell).
  const card = document.createElement('section');
  card.className = 'usage-card common shared flex row col';
  const usage = document.createElement('span');
  usage.id = 'usage-value';
  usage.className = 'metric value percent common';
  usage.textContent = '42% remaining';
  const fillerHost = document.createElement('div');
  fillerHost.className = 'thread common shared flex col';
  for (let index = 0; index < nodeCount; index += 1) {
    const item = document.createElement('div');
    item.className = `item common shared row col item-${index % 17}`;
    item.setAttribute('data-i', String(index));
    // Mixed reset-like noise so regex paths run, but longer than 180 so filters skip after compactText.
    item.textContent = `Message ${index}: lorem ipsum dolor sit amet session ${index * 7} tokens used today`;
    fillerHost.append(item);
  }
  if (mode === 'usage-in-huge-card') {
    // Parent of usage is the card that also owns the huge thread → inferResetAnchor scans * under card.
    card.append(usage, fillerHost);
    root.append(card);
  } else {
    let parent: HTMLElement = root;
    for (let depth = 0; depth < 12; depth += 1) {
      const layer = document.createElement('div');
      layer.className = `layer-${depth} shared common flex row col token-${depth % 5}`;
      parent.append(layer);
      parent = layer;
    }
    parent.append(usage);
    root.append(fillerHost);
  }
  document.body.replaceChildren(root);
  return usage;
}

function timed<T>(label: string, run: () => T): { label: string; ms: number; result: T } {
  const start = performance.now();
  const result = run();
  const ms = performance.now() - start;
  // eslint-disable-next-line no-console
  console.log(`[perf-obs] ${label}: ${ms.toFixed(1)}ms`);
  return { label, ms, result };
}

describe('perf observation on large SPA-like DOM', () => {
  it('times teach hot paths when usage sits inside a huge layout card', () => {
    const samples: Array<{ nodes: number; timings: Record<string, number> }> = [];

    for (const nodeCount of [5_000, 15_000, 40_000]) {
      const target = buildLargeSpaDom(nodeCount, 'usage-in-huge-card');
      const actualNodes = document.querySelectorAll('*').length;
      const timings: Record<string, number> = { nodes: actualNodes };

      timings.extractValue = timed(`extractValue n≈${actualNodes}`, () => extractValue(target)).ms;
      timings.refineValueElement = timed(`refineValueElement n≈${actualNodes}`, () => refineValueElement(target.parentElement!)).ms;
      timings.createAnchorFingerprint = timed(`createAnchorFingerprint n≈${actualNodes}`, () => createAnchorFingerprint(target)).ms;
      timings.inferResetAnchor = timed(`inferResetAnchor n≈${actualNodes}`, () => inferResetAnchor(target)).ms;
      timings.makeMetric = timed(`makeMetric n≈${actualNodes}`, () => makeMetric(target)).ms;
      timings.makeMetricFromCard = timed(`makeMetric(card) n≈${actualNodes}`, () => makeMetric(target.parentElement!)).ms;

      const anchor = createAnchorFingerprint(target);
      const broken = { ...anchor, selectors: ['#does-not-exist-on-page'] };
      timings.findByFingerprint = timed(`findByFingerprint n≈${actualNodes}`, () => findByFingerprint(document, broken)).ms;

      samples.push({ nodes: actualNodes, timings });
      expect(actualNodes).toBeGreaterThan(nodeCount);
    }

    // eslint-disable-next-line no-console
    console.log('[perf-obs] summary', JSON.stringify(samples, null, 2));
    expect(samples).toHaveLength(3);
  });
});
