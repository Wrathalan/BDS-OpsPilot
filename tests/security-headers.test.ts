import { describe, expect, it } from "vitest";
import { createSecurityHeaders } from "@/lib/security-headers";

describe("production security headers", () => {
  it("restricts browser traffic to the self-hosted control plane", () => {
    const headers = new Map(createSecurityHeaders(true).map(({ key, value }) => [key, value]));
    const csp = headers.get("Content-Security-Policy") ?? "";

    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Permissions-Policy")).toContain("browsing-topics=()");
  });

  it("allows the Next.js development evaluator only outside production", () => {
    const headers = new Map(createSecurityHeaders(false).map(({ key, value }) => [key, value]));
    expect(headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
  });
});
