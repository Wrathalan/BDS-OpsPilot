import { describe, expect, it } from "vitest";
import { resolveSecureSessionCookie } from "@/lib/session-cookie";

describe("session-cookie transport security", () => {
  it("allows an authenticated session on an explicit HTTP LAN origin in a production build", () => {
    expect(resolveSecureSessionCookie("http://192.168.2.211:3000", undefined, "production")).toBe(false);
  });

  it("marks the cookie secure when the configured origin uses HTTPS", () => {
    expect(resolveSecureSessionCookie("https://opspilot.example.test", undefined, "production")).toBe(true);
  });

  it("supports an explicit secure override for TLS-terminating reverse proxies", () => {
    expect(resolveSecureSessionCookie("http://opspilot:3000", "true", "production")).toBe(true);
  });

  it("rejects an ambiguous cookie-security override", () => {
    expect(() => resolveSecureSessionCookie("http://192.168.2.211:3000", "sometimes", "production")).toThrow(/true or false/i);
  });
});
