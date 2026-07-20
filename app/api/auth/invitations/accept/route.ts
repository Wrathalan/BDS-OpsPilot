import { hash } from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientAddress } from "@/lib/login-rate-limit";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";
import { hashTechnicianInviteToken, technicianInvitePrefix, technicianInviteStatus, validTechnicianPassword } from "@/lib/technician-invitations";

const inputSchema = z.object({
  token: z.string().startsWith(technicianInvitePrefix).max(160),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,40}$/),
  password: z.string().min(12).max(200).refine(validTechnicianPassword),
});

export async function POST(request: Request) {
  if (!isTrustedBrowserOrigin(request)) return NextResponse.json({ error: "Request origin was not accepted." }, { status: 403 });
  try {
    const input = inputSchema.parse(await request.json());
    const invite = await db.technicianInvite.findUnique({
      where: { tokenHash: hashTechnicianInviteToken(input.token) },
      include: { role: true, organizationScopes: true },
    });
    if (!invite || technicianInviteStatus(invite) !== "pending") return NextResponse.json({ error: "This invitation is invalid, expired, revoked, or already used." }, { status: 410 });
    const username = input.username.trim().toLowerCase();
    const existing = await db.user.findFirst({ where: { tenantId: invite.tenantId, OR: [{ username }, { email: invite.email }] } });
    if (existing) return NextResponse.json({ error: "That username or email address is already registered." }, { status: 409 });
    const passwordHash = await hash(input.password, 12);
    const acceptedAt = new Date();
    const account = await db.$transaction(async (tx) => {
      const claimed = await tx.technicianInvite.updateMany({ where: { id: invite.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: acceptedAt } }, data: { acceptedAt } });
      if (claimed.count !== 1) throw new Error("Invitation unavailable");
      const user = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          roleId: invite.roleId,
          email: invite.email,
          username,
          name: invite.name,
          passwordHash,
          active: true,
          allOrganizations: invite.allOrganizations,
          scopes: invite.allOrganizations ? undefined : { create: invite.organizationScopes.map(({ organizationId }) => ({ organizationId })) },
        },
      });
      await tx.auditEvent.create({ data: { tenantId: invite.tenantId, actorId: user.id, action: "technician_invite.accepted", resourceType: "User", resourceId: user.id, requestContext: clientAddress(request), afterSummary: JSON.stringify({ inviteId: invite.id, role: invite.role.systemKey, allOrganizations: invite.allOrganizations, organizationIds: invite.organizationScopes.map(({ organizationId }) => organizationId) }) } });
      return user;
    });
    await createSession(account.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Use a valid username and a 12+ character password containing upper- and lowercase letters, a number, and a symbol." }, { status: 400 });
    if (error instanceof Error && error.message === "Invitation unavailable") return NextResponse.json({ error: "This invitation is invalid, expired, revoked, or already used." }, { status: 410 });
    return NextResponse.json({ error: "The technician account could not be created." }, { status: 400 });
  }
}
