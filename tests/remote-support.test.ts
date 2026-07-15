import { afterEach, describe, expect, it } from "vitest";
import { createRdpProfile, createRustDeskDeepLink, decryptRemoteSecret, encryptRemoteSecret, parseRdpEndpoint } from "@/lib/remote-support";

const originalSessionSecret = process.env.SESSION_SECRET;

afterEach(() => {
  process.env.SESSION_SECRET = originalSessionSecret;
});

describe("remote-support secrets", () => {
  it("encrypts RustDesk passwords with authenticated encryption", () => {
    process.env.SESSION_SECRET = "unit-test-session-secret-with-enough-entropy";
    const encrypted = encryptRemoteSecret("endpoint-password-123");
    expect(encrypted).not.toContain("endpoint-password-123");
    expect(decryptRemoteSecret(encrypted)).toBe("endpoint-password-123");
  });

  it("includes the self-hosted RustDesk key and endpoint password in native primary links", () => {
    expect(createRustDeskDeepLink("169508366", "192.168.2.107:21116", "server/key+=", "p@ss word/=")).toBe("rustdesk://169508366/r@192.168.2.107:21116?key=server%2Fkey%2B%3D&password=p%40ss+word%2F%3D");
  });

  it("creates a credential-prompting NLA RDP fallback profile without device redirection", () => {
    const profile = createRdpProfile("192.168.2.107");
    expect(profile).toContain("full address:s:192.168.2.107:3389");
    expect(profile).toContain("authentication level:i:2");
    expect(profile).toContain("prompt for credentials:i:1");
    expect(profile).toContain("redirectdrives:i:0");
  });

  it("rejects unsafe RDP targets", () => {
    expect(() => createRdpProfile("host\r\nusername:s:attacker")).toThrow(/invalid/i);
  });

  it("parses an agent-reported RDP endpoint", () => {
    expect(parseRdpEndpoint("192.168.2.107:3389")).toEqual({ host: "192.168.2.107", port: 3389 });
  });
});
