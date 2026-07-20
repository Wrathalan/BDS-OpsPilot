import { createHash } from "node:crypto";

export const technicianInvitePrefix = "ops_invite_";

export function hashTechnicianInviteToken(token: string) {
  return createHash("sha256").update(`${token}:${process.env.SESSION_SECRET}`).digest("hex");
}

export function technicianInviteStatus(invite: { acceptedAt: Date | string | null; revokedAt: Date | string | null; expiresAt: Date | string }, now = new Date()) {
  if (invite.acceptedAt) return "accepted" as const;
  if (invite.revokedAt) return "revoked" as const;
  if (new Date(invite.expiresAt).getTime() <= now.getTime()) return "expired" as const;
  return "pending" as const;
}

export function validTechnicianPassword(password: string) {
  return password.length >= 12
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}
