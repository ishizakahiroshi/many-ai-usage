export interface CaptureRequest {
  providerId?: string;
  requestId?: string;
  reason: 'forced_refresh';
}

export interface CaptureEnqueueResult {
  coalesced: boolean;
  dropped?: CaptureRequest;
}

/** Bounded FIFO. Exact retries coalesce; distinct provider/request IDs keep their order. */
export class CaptureRequestQueue {
  readonly capacity: number;
  private readonly items: CaptureRequest[] = [];

  constructor(capacity = 16) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('Capture queue capacity must be positive');
    this.capacity = capacity;
  }

  private key(request: CaptureRequest): string {
    return request.requestId ? `request:${request.requestId}` : `provider:${request.providerId ?? '*'}`;
  }

  enqueue(request: CaptureRequest): CaptureEnqueueResult {
    const key = this.key(request);
    const existing = this.items.findIndex((item) => this.key(item) === key);
    if (existing >= 0) {
      this.items[existing] = request;
      return { coalesced: true };
    }
    const dropped = this.items.length >= this.capacity ? this.items.shift() : undefined;
    this.items.push(request);
    return { coalesced: false, ...(dropped ? { dropped } : {}) };
  }

  dequeue(): CaptureRequest | undefined {
    return this.items.shift();
  }

  snapshot(): readonly CaptureRequest[] {
    return [...this.items];
  }
}
