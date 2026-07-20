import { afterEach, describe, expect, it, vi } from "vitest";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browser mutation origins", () => {
  it("accepts the configured origin and rejects cross-site requests", () => {
    vi.stubEnv("APP_URL", "https://ops.example.test");
    vi.stubEnv("NODE_ENV", "production");

    expect(isTrustedBrowserOrigin(new Request("https://ops.example.test/api", { headers: { origin: "https://ops.example.test" } }))).toBe(true);
    expect(isTrustedBrowserOrigin(new Request("https://ops.example.test/api", { headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" } }))).toBe(false);
  });
});
