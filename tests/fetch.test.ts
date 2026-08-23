import { describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '../src/shared/fetch';

function abortableNeverFetch(): typeof fetch {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  })) as unknown as typeof fetch;
}

describe('fetchWithTimeout', () => {
  it('aborts a never-resolving request at the configured deadline', async () => {
    const fetchImpl = abortableNeverFetch();
    await expect(fetchWithTimeout('https://example.test/data.json', {}, fetchImpl, 5))
      .rejects.toThrow('Request timed out after 5 ms');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('preserves a caller abort instead of relabelling it as a timeout', async () => {
    const fetchImpl = abortableNeverFetch();
    const controller = new AbortController();
    const pending = fetchWithTimeout('https://example.test/data.json', { signal: controller.signal }, fetchImpl, 1_000);
    controller.abort(new DOMException('cancelled by user', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
