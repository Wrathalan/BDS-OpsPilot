import { createHash } from "node:crypto";

type AttemptBucket = { count: number; resetAt: number };

export class LoginRateLimiter {
  private readonly attempts = new Map<string, AttemptBucket>();

  constructor(
    private readonly limit = 8,
    private readonly windowMs = 15 * 60_000,
    private readonly maxEntries = 5_000,
  ) {}

  isBlocked(address: string, identifier: string, now = Date.now()) {
    this.prune(now);
    return this.keys(address, identifier).some((key) => {
      const bucket = this.attempts.get(key);
      return Boolean(bucket && bucket.resetAt > now && bucket.count >= this.limit);
    });
  }

  recordFailure(address: string, identifier: string, now = Date.now()) {
    this.prune(now);
    for (const key of this.keys(address, identifier)) {
      const current = this.attempts.get(key);
      this.attempts.set(key, current && current.resetAt > now
        ? { count: current.count + 1, resetAt: current.resetAt }
        : { count: 1, resetAt: now + this.windowMs });
    }
    this.trimToLimit();
  }

  clear(address: string, identifier: string) {
    for (const key of this.keys(address, identifier)) this.attempts.delete(key);
  }

  private keys(address: string, identifier: string) {
    const accountHash = createHash("sha256").update(identifier.trim().toLowerCase()).digest("hex");
    return [`address:${address.trim().slice(0, 128) || "local"}`, `account:${accountHash}`];
  }

  private prune(now: number) {
    for (const [key, bucket] of this.attempts) {
      if (bucket.resetAt <= now) this.attempts.delete(key);
    }
  }

  private trimToLimit() {
    if (this.attempts.size <= this.maxEntries) return;
    const oldest = [...this.attempts.entries()].sort((left, right) => left[1].resetAt - right[1].resetAt);
    for (const [key] of oldest.slice(0, this.attempts.size - this.maxEntries)) this.attempts.delete(key);
  }
}

export const loginRateLimiter = new LoginRateLimiter();

export function clientAddress(request: Request) {
  return (request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",", 1)[0] ?? "local").trim().slice(0, 128) || "local";
}
