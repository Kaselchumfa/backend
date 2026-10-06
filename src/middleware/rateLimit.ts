import { createHash } from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { getLogger } from "../lib/logger.js";
import type { RateLimitStore } from "../lib/rateLimit/index.js";
import { parsePayerFromXPayment } from "../lib/parseXPayment.js";
import { rateLimitCounter } from "../lib/metrics.js";

export const RATE_LIMITED = "RATE_LIMITED";

function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function sendRateLimitHeaders(
  res: Response,
  limit: number,
  remaining: number,
  resetAt: number,
): void {
  res.setHeader("RateLimit-Limit", String(limit));
  res.setHeader("RateLimit-Remaining", String(Math.max(0, remaining)));
  res.setHeader("RateLimit-Reset", String(Math.ceil(resetAt / 1000)));
}

function sendTooManyRequests(res: Response, retryAfterSeconds: number, limiterName?: string): void {
  if (limiterName) {
    rateLimitCounter.inc({ limiter: limiterName });
  }
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "Too many requests",
    code: RATE_LIMITED,
    retryAfterSeconds,
  });
}

export interface RateLimiterOptions {
  store: RateLimitStore;
  max: number;
  windowMs: number;
  keyGenerator: (req: Request) => string;
  skip?: (req: Request) => boolean;
  limiterName?: string;
}

export function createRateLimiter(options: RateLimiterOptions): RequestHandler {
  const { store, max, windowMs, keyGenerator, skip, limiterName } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) {
      next();
      return;
    }

    const key = keyGenerator(req);

    try {
      const result = await store.consume(key, max, windowMs);
      sendRateLimitHeaders(res, result.limit, result.remaining, result.resetAt);

      if (!result.allowed) {
        sendTooManyRequests(
          res,
          result.retryAfterSeconds ?? Math.ceil(windowMs / 1000),
          limiterName,
        );
        return;
      }

      next();
    } catch (err) {
      // Fail open when the shared store is unavailable so traffic isn't blocked entirely.
      getLogger().warn({ event: "rate_limit_store_error", err, key }, "rate limit store error");
      next();
    }
  };
}

export function createIpRateLimiter(
  store: RateLimitStore,
  namespace: string,
  max: number,
  windowMs: number,
  limiterName?: string,
): RequestHandler {
  return createRateLimiter({
    store,
    max,
    windowMs,
    limiterName: limiterName ?? `${namespace}_ip`,
    keyGenerator: (req) => `${namespace}:ip:${clientIp(req)}`,
  });
}

export function createWalletRateLimiter(
  store: RateLimitStore,
  namespace: string,
  max: number,
  windowMs: number,
  getWallet: (req: Request) => string | undefined,
  limiterName?: string,
): RequestHandler {
  return createRateLimiter({
    store,
    max,
    windowMs,
    limiterName: limiterName ?? `${namespace}_wallet`,
    skip: (req) => !getWallet(req),
    keyGenerator: (req) => `${namespace}:wallet:${getWallet(req)}`,
  });
}

export function extractPayerFromPaymentHeader(req: Request): string | undefined {
  const header = req.headers["x-payment"];
  if (!header || typeof header !== "string") {
    return undefined;
  }
  return parsePayerFromXPayment(header).payer;
}

export interface PublisherRateLimitOverride {
  max: number;
  windowMs: number;
}

export interface PublisherRateLimiterOptions {
  store: RateLimitStore;
  namespace: string;
  max: number;
  windowMs: number;
  /**
   * Resolves the publisher identity for a request. Defaults to `req.publisher.id`,
   * falling back to a hash of the API key when no publisher is attached.
   */
  getPublisherKey?: (req: Request) => string | undefined;
  /**
   * Resolves per-publisher limit overrides. Returning `undefined` falls back to
   * the default `max`/`windowMs` supplied to the factory.
   */
  resolveOverride?: (
    publisherKey: string,
    req: Request,
  ) => PublisherRateLimitOverride | undefined;
  skip?: (req: Request) => boolean;
  limiterName?: string;
}

function defaultPublisherKey(req: Request): string | undefined {
  const publisher = (req as Request & { publisher?: { id?: string } }).publisher;
  if (publisher?.id) {
    return publisher.id;
  }

  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string" && apiKey.length > 0) {
    return hashApiKey(apiKey);
  }

  return undefined;
}

function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function createPublisherRateLimiter(
  options: PublisherRateLimiterOptions,
): RequestHandler {
  const {
    store,
    namespace,
    max,
    windowMs,
    getPublisherKey = defaultPublisherKey,
    resolveOverride,
    skip,
    limiterName,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip?.(req)) {
      next();
      return;
    }

    const publisherKey = getPublisherKey(req);
    if (!publisherKey) {
      next();
      return;
    }

    const override = resolveOverride?.(publisherKey, req);
    const effectiveMax = override?.max ?? max;
    const effectiveWindowMs = override?.windowMs ?? windowMs;
    const key = `${namespace}:publisher:${publisherKey}`;

    try {
      const result = await store.consume(key, effectiveMax, effectiveWindowMs);
      sendRateLimitHeaders(res, result.limit, result.remaining, result.resetAt);

      if (!result.allowed) {
        sendTooManyRequests(
          res,
          result.retryAfterSeconds ?? Math.ceil(effectiveWindowMs / 1000),
          limiterName ?? `${namespace}_publisher`,
        );
        return;
      }

      next();
    } catch (err) {
      // Fail open when the shared store is unavailable so traffic isn't blocked entirely.
      getLogger().warn(
        { event: "rate_limit_store_error", err, key },
        "rate limit store error",
      );
      next();
    }
  };
}
