export interface RateLimitConsumeResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch milliseconds when the client can retry or the window fully resets. */
  resetAt: number;
  retryAfterSeconds?: number;
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitConsumeResult>;
  close?(): Promise<void>;
}

/**
 * Key convention for rate limiting.
 *
 * Keys are opaque strings. To scope a limit to a specific publisher, prefix the
 * key with the publisher identifier, e.g. `publisher:<publisherId>` or
 * `publisher:<publisherId>:<action>`. This keeps publisher-scoped buckets
 * isolated from global or other-scoped buckets while requiring no changes to
 * the store interface.
 */
export type RateLimitKey = string;