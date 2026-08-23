import { describe, expect, it } from 'vitest';
import { CaptureRequestQueue } from '../src/content/captureQueue';

describe('CaptureRequestQueue', () => {
  it('keeps distinct forced requests in FIFO order and coalesces exact retries', () => {
    const queue = new CaptureRequestQueue(4);
    queue.enqueue({ providerId: 'one', requestId: 'r1', reason: 'forced_refresh' });
    queue.enqueue({ providerId: 'two', requestId: 'r2', reason: 'forced_refresh' });
    expect(queue.enqueue({ providerId: 'one', requestId: 'r1', reason: 'forced_refresh' })).toEqual({ coalesced: true });
    queue.enqueue({ providerId: 'three', requestId: 'r3', reason: 'forced_refresh' });

    expect([queue.dequeue(), queue.dequeue(), queue.dequeue()].map((item) => item?.requestId))
      .toEqual(['r1', 'r2', 'r3']);
  });

  it('has a deterministic bound and reports the oldest displaced request', () => {
    const queue = new CaptureRequestQueue(2);
    queue.enqueue({ providerId: 'one', requestId: 'r1', reason: 'forced_refresh' });
    queue.enqueue({ providerId: 'two', requestId: 'r2', reason: 'forced_refresh' });
    const result = queue.enqueue({ providerId: 'three', requestId: 'r3', reason: 'forced_refresh' });

    expect(result.dropped?.requestId).toBe('r1');
    expect(queue.snapshot().map((item) => item.requestId)).toEqual(['r2', 'r3']);
  });
});
