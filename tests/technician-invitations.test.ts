import { beforeEach, describe, expect, it } from "vitest";
import { hashTechnicianInviteToken, technicianInviteStatus, validTechnicianPassword } from "@/lib/technician-invitations";

describe("technician invitations", () => {
  beforeEach(() => { process.env.SESSION_SECRET = "test-secret-that-is-longer-than-thirty-two-characters"; });

  it("hashes invitation tokens without storing plaintext", () => {
    const token = "ops_invite_example-token";
    expect(hashTechnicianInviteToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashTechnicianInviteToken(token)).not.toContain(token);
  });

  it("reports terminal states before expiration", () => {
    const future = new Date("2030-01-02T00:00:00Z");
    const now = new Date("2030-01-01T00:00:00Z");
    expect(technicianInviteStatus({ acceptedAt: null, revokedAt: null, expiresAt: future }, now)).toBe("pending");
    expect(technicianInviteStatus({ acceptedAt: now, revokedAt: null, expiresAt: future }, now)).toBe("accepted");
    expect(technicianInviteStatus({ acceptedAt: null, revokedAt: now, expiresAt: future }, now)).toBe("revoked");
    expect(technicianInviteStatus({ acceptedAt: null, revokedAt: null, expiresAt: now }, now)).toBe("expired");
  });

  it("requires a strong technician password", () => {
    expect(validTechnicianPassword("short")).toBe(false);
    expect(validTechnicianPassword("longbutlowercase1!")).toBe(false);
    expect(validTechnicianPassword("Valid-Tech-Password1!")).toBe(true);
  });
});
