import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "@/lib/login-rate-limit";

describe("login rate limiting", () => {
  it("limits both a client address and an account", () => {
    const limiter = new LoginRateLimiter(2, 1_000, 10);
    limiter.recordFailure("192.0.2.1", "root", 100);
    limiter.recordFailure("192.0.2.1", "root", 100);

    expect(limiter.isBlocked("192.0.2.1", "another-user", 200)).toBe(true);
    expect(limiter.isBlocked("198.51.100.2", "ROOT", 200)).toBe(true);
  });

  it("expires old failures and clears a successful login", () => {
    const limiter = new LoginRateLimiter(1, 1_000, 10);
    limiter.recordFailure("192.0.2.1", "root", 100);
    expect(limiter.isBlocked("192.0.2.1", "root", 200)).toBe(true);

    limiter.clear("192.0.2.1", "root");
    expect(limiter.isBlocked("192.0.2.1", "root", 200)).toBe(false);

    limiter.recordFailure("192.0.2.1", "root", 100);
    expect(limiter.isBlocked("192.0.2.1", "root", 1_101)).toBe(false);
  });
});
