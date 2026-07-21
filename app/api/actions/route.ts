import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { hashAgentSecret } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { canRunAutomation } from "@/lib/domain";
import { clientAddress } from "@/lib/login-rate-limit";
import { normalizeOrganizationSlug, organizationSlugPattern } from "@/lib/organizations";
import { assertOrganization, assertPermission, AuthorizationError, type SessionUser } from "@/lib/rbac";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";
import { hashTechnicianInviteToken, technicianInvitePrefix } from "@/lib/technician-invitations";

const id = z.string().min(1).max(80);
const optionalId = z.union([id, z.literal("")]).optional();
const organizationSlug = z.preprocess(
  (value) => typeof value === "string" ? normalizeOrganizationSlug(value) : value,
  z.string().min(2, "Enter at least two letters or numbers for the URL slug.").max(80, "The URL slug must be 80 characters or fewer.").regex(organizationSlugPattern, "Use letters, numbers, and single hyphens for the URL slug."),
);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createOrganization"), name: z.string().trim().min(2, "Enter an organization name.").max(100), slug: organizationSlug, industry: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("createLocation"), organizationId: id, name: z.string().min(2).max(100), address: z.string().max(200).optional() }),
  z.object({ action: z.literal("createPolicy"), name: z.string().min(3).max(100), description: z.string().max(300), organizationId: optionalId, parentId: optionalId }),
  z.object({ action: z.literal("createEnrollmentToken"), organizationId: id, locationId: id, name: z.string().min(2).max(100), expiresInHours: z.coerce.number().int().min(1).max(168).default(24), maxUses: z.coerce.number().int().min(1).max(100).default(1) }),
  z.object({ action: z.literal("revokeEnrollmentToken"), tokenId: id }),
  z.object({ action: z.literal("createTechnicianInvite"), email: z.string().email().max(160), name: z.string().min(2).max(100), roleKey: z.enum(["admin", "technician", "auditor"]).default("technician"), allOrganizations: z.boolean().default(false), organizationIds: z.array(id).max(100).default([]), expiresInHours: z.coerce.number().int().min(1).max(168).default(48) }),
  z.object({ action: z.literal("revokeTechnicianInvite"), inviteId: id }),
  z.object({ action: z.literal("updateTechnician"), technicianId: id, email: z.string().trim().email().max(160), name: z.string().trim().min(2).max(100), roleKey: z.enum(["admin", "technician", "auditor"]), active: z.boolean(), allOrganizations: z.boolean(), organizationIds: z.array(id).max(100).default([]) }),
  z.object({ action: z.literal("deleteTechnician"), technicianId: id }),
  z.object({ action: z.literal("runAutomation"), deviceId: id, automationId: id, confirmed: z.boolean().optional() }),
  z.object({ action: z.literal("updateAlert"), alertId: id, status: z.enum(["acknowledged", "suppressed", "resolved"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("updateTicket"), ticketId: id, status: z.enum(["new", "open", "waiting_on_user", "resolved", "closed"]), comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("patchAction"), patchId: id, operation: z.enum(["approve", "reject", "testing", "schedule"]) }),
]);

function requestContext(request: Request) {
  return clientAddress(request);
}

function validateOrigin(request: Request) {
  if (!isTrustedBrowserOrigin(request)) throw new AuthorizationError("Request origin was not accepted.");
}

async function audit(user: SessionUser, request: Request, action: string, resourceType: string, resourceId: string, organizationId?: string | null, beforeSummary?: unknown, afterSummary?: unknown, success = true) {
  await db.auditEvent.create({ data: { tenantId: user.tenantId, organizationId, actorId: user.id, action, resourceType, resourceId, requestContext: requestContext(request), beforeSummary: beforeSummary === undefined ? null : JSON.stringify(beforeSummary), afterSummary: afterSummary === undefined ? null : JSON.stringify(afterSummary), success } });
}

async function scopedDevice(user: SessionUser, deviceId: string) {
  const device = await db.device.findFirst({ where: { id: deviceId, tenantId: user.tenantId } });
  if (!device) throw new Error("Device was not found.");
  assertOrganization(user, device.organizationId);
  return device;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });
  try {
    validateOrigin(request);
    const input = actionSchema.parse(await request.json());

    if (input.action === "createOrganization") {
      assertPermission(user, "organization.manage");
      const existing = await db.organization.findUnique({ where: { tenantId_slug: { tenantId: user.tenantId, slug: input.slug } } });
      if (existing) throw new Error("An organization with this URL slug already exists.");
      const organization = await db.organization.create({ data: { tenantId: user.tenantId, name: input.name, slug: input.slug, industry: input.industry || "Business Services" } });
      await audit(user, request, "organization.created", "Organization", organization.id, organization.id, null, { name: organization.name });
      return NextResponse.json({ ok: true, organization });
    }
    if (input.action === "createLocation") {
      assertPermission(user, "organization.manage");
      assertOrganization(user, input.organizationId);
      const organization = await db.organization.findFirst({ where: { id: input.organizationId, tenantId: user.tenantId } });
      if (!organization) throw new Error("Organization was not found.");
      const location = await db.location.create({ data: { organizationId: organization.id, name: input.name, address: input.address || null } });
      await audit(user, request, "location.created", "Location", location.id, organization.id, null, { name: location.name });
      return NextResponse.json({ ok: true, location });
    }
    if (input.action === "createPolicy") {
      assertPermission(user, "tenant.manage");
      if (input.organizationId) assertOrganization(user, input.organizationId);
      const policy = await db.policy.create({ data: { tenantId: user.tenantId, parentId: input.parentId || null, name: input.name, description: input.description, settings: JSON.stringify({ cpuThreshold: 90, memoryThreshold: 90, diskFreeThreshold: 10, offlineMinutes: 15, patchMode: "manual-approval", maintenanceWindow: "Unassigned", rebootBehavior: "manual-approval", requiredSoftware: [], prohibitedSoftware: [], notifications: ["in-app"] }), conditions: { create: [{ type: "cpu_high", comparator: ">", threshold: 90, durationMinutes: 10, severity: "warning" }, { type: "memory_high", comparator: ">", threshold: 90, durationMinutes: 10, severity: "warning" }, { type: "disk_low", comparator: "<", threshold: 10, durationMinutes: 5, severity: "critical", createTicket: true }] } } });
      if (input.organizationId) await db.policyAssignment.create({ data: { policyId: policy.id, organizationId: input.organizationId } });
      await audit(user, request, "policy.created", "Policy", policy.id, input.organizationId || null, null, { name: policy.name, assigned: Boolean(input.organizationId) });
      return NextResponse.json({ ok: true, policy });
    }
    if (input.action === "createEnrollmentToken") {
      assertPermission(user, "device.manage");
      assertOrganization(user, input.organizationId);
      const location = await db.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId }, include: { organization: true } });
      if (!location || location.organization.tenantId !== user.tenantId) throw new Error("Location does not belong to the selected organization.");
      const plaintext = `ops_enroll_${randomBytes(32).toString("base64url")}`;
      const token = await db.enrollmentToken.create({ data: { tenantId: user.tenantId, organizationId: input.organizationId, locationId: input.locationId, createdById: user.id, name: input.name, tokenHash: hashAgentSecret(plaintext), tokenPrefix: plaintext.slice(0, 19), expiresAt: new Date(Date.now() + input.expiresInHours * 3_600_000), maxUses: input.maxUses } });
      await audit(user, request, "enrollment_token.created", "EnrollmentToken", token.id, input.organizationId, null, { name: token.name, tokenPrefix: token.tokenPrefix, expiresAt: token.expiresAt, maxUses: token.maxUses });
      return NextResponse.json({ ok: true, token: plaintext, tokenId: token.id, expiresAt: token.expiresAt });
    }
    if (input.action === "revokeEnrollmentToken") {
      assertPermission(user, "device.manage");
      const token = await db.enrollmentToken.findFirst({ where: { id: input.tokenId, tenantId: user.tenantId } });
      if (!token) throw new Error("Enrollment token was not found.");
      assertOrganization(user, token.organizationId);
      await db.enrollmentToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
      await audit(user, request, "enrollment_token.revoked", "EnrollmentToken", token.id, token.organizationId, { revokedAt: token.revokedAt }, { revokedAt: new Date() });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "createTechnicianInvite") {
      assertPermission(user, "tenant.manage");
      const email = input.email.trim().toLowerCase();
      const existingUser = await db.user.findFirst({ where: { tenantId: user.tenantId, email, deletedAt: null } });
      if (existingUser) throw new Error("A user with this email address already exists.");
      const role = await db.role.findFirst({ where: { tenantId: user.tenantId, systemKey: input.roleKey } });
      if (!role) throw new Error("The selected role is not available.");
      const allOrganizations = input.roleKey === "admin" || input.allOrganizations;
      const organizationIds = [...new Set(input.organizationIds)];
      if (!allOrganizations && !organizationIds.length) throw new Error("Select at least one organization or grant access to all organizations.");
      if (organizationIds.length) {
        const matchingOrganizations = await db.organization.count({ where: { tenantId: user.tenantId, id: { in: organizationIds } } });
        if (matchingOrganizations !== organizationIds.length) throw new AuthorizationError("One or more selected organizations are outside this tenant.");
      }
      const plaintext = `${technicianInvitePrefix}${randomBytes(32).toString("base64url")}`;
      const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
      const invite = await db.$transaction(async (tx) => {
        await tx.technicianInvite.updateMany({ where: { tenantId: user.tenantId, email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
        return tx.technicianInvite.create({ data: { tenantId: user.tenantId, roleId: role.id, createdById: user.id, email, name: input.name.trim(), tokenHash: hashTechnicianInviteToken(plaintext), tokenPrefix: plaintext.slice(0, 20), allOrganizations, expiresAt, organizationScopes: allOrganizations ? undefined : { create: organizationIds.map((organizationId) => ({ organizationId })) } } });
      });
      await audit(user, request, "technician_invite.created", "TechnicianInvite", invite.id, null, null, { email, role: role.systemKey, allOrganizations: invite.allOrganizations, organizationIds: allOrganizations ? [] : organizationIds, expiresAt });
      const invitationUrl = new URL(`/invite/${plaintext}`, process.env.APP_URL || "http://127.0.0.1:3000").toString();
      return NextResponse.json({ ok: true, inviteId: invite.id, invitationUrl, expiresAt });
    }
    if (input.action === "revokeTechnicianInvite") {
      assertPermission(user, "tenant.manage");
      const invite = await db.technicianInvite.findFirst({ where: { id: input.inviteId, tenantId: user.tenantId } });
      if (!invite) throw new Error("Operator invitation was not found.");
      if (invite.acceptedAt) throw new Error("An accepted invitation cannot be revoked. Disable the user account instead.");
      if (!invite.revokedAt) await db.technicianInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
      await audit(user, request, "technician_invite.revoked", "TechnicianInvite", invite.id, null, { revokedAt: invite.revokedAt }, { revokedAt: new Date() });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "updateTechnician") {
      assertPermission(user, "tenant.manage");
      const technician = await db.user.findFirst({ where: { id: input.technicianId, tenantId: user.tenantId, deletedAt: null }, include: { role: true, scopes: true } });
      if (!technician) throw new Error("Operator account was not found.");
      if (technician.id === user.id) throw new AuthorizationError("You cannot edit your own account from operator management.");
      if (technician.username.toLowerCase() === (process.env.BOOTSTRAP_ADMIN_USERNAME || "root").toLowerCase()) throw new AuthorizationError("The bootstrap root account is protected.");
      if (!["admin", "technician", "auditor"].includes(technician.role.systemKey)) throw new AuthorizationError("This account role cannot be edited here.");
      const role = await db.role.findFirst({ where: { tenantId: user.tenantId, systemKey: input.roleKey } });
      if (!role) throw new Error("The selected role is not available.");
      const allOrganizations = input.roleKey === "admin" || input.allOrganizations;
      const email = input.email.toLowerCase();
      const duplicate = await db.user.findFirst({ where: { tenantId: user.tenantId, email, deletedAt: null, id: { not: technician.id } } });
      if (duplicate) throw new Error("A user with this email address already exists.");
      const organizationIds = [...new Set(input.organizationIds)];
      if (!allOrganizations && !organizationIds.length) throw new Error("Select at least one organization or grant access to all organizations.");
      if (organizationIds.length) {
        const matchingOrganizations = await db.organization.count({ where: { tenantId: user.tenantId, id: { in: organizationIds } } });
        if (matchingOrganizations !== organizationIds.length) throw new AuthorizationError("One or more selected organizations are outside this tenant.");
      }
      const before = { name: technician.name, email: technician.email, role: technician.role.systemKey, active: technician.active, allOrganizations: technician.allOrganizations, organizationIds: technician.scopes.map((scope) => scope.organizationId) };
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: technician.id }, data: { name: input.name, email, roleId: role.id, active: input.active, allOrganizations } });
        await tx.userOrganizationScope.deleteMany({ where: { userId: technician.id } });
        if (!allOrganizations && organizationIds.length) await tx.userOrganizationScope.createMany({ data: organizationIds.map((organizationId) => ({ userId: technician.id, organizationId })) });
        if (!input.active) await tx.session.deleteMany({ where: { userId: technician.id } });
      });
      await audit(user, request, "technician.updated", "User", technician.id, null, before, { name: input.name, email, role: role.systemKey, active: input.active, allOrganizations, organizationIds: allOrganizations ? [] : organizationIds });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "deleteTechnician") {
      assertPermission(user, "tenant.manage");
      const technician = await db.user.findFirst({ where: { id: input.technicianId, tenantId: user.tenantId, deletedAt: null }, include: { role: true } });
      if (!technician) throw new Error("Operator account was not found.");
      if (technician.id === user.id) throw new AuthorizationError("You cannot delete your own account from operator management.");
      if (technician.username.toLowerCase() === (process.env.BOOTSTRAP_ADMIN_USERNAME || "root").toLowerCase()) throw new AuthorizationError("The bootstrap root account is protected.");
      if (!["admin", "technician", "auditor"].includes(technician.role.systemKey)) throw new AuthorizationError("This account role cannot be deleted here.");
      const deletedAt = new Date();
      await db.$transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId: technician.id } });
        await tx.userOrganizationScope.deleteMany({ where: { userId: technician.id } });
        await tx.user.update({ where: { id: technician.id }, data: { active: false, allOrganizations: false, deletedAt, name: "Deleted operator", email: `deleted+${technician.id}@local.invalid`, username: `deleted-${technician.id}` } });
      });
      await audit(user, request, "technician.deleted", "User", technician.id, null, { name: technician.name, email: technician.email, role: technician.role.systemKey, active: technician.active }, { deletedAt, retainedForAudit: true });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "runAutomation") {
      assertPermission(user, "automation.run");
      const device = await scopedDevice(user, input.deviceId);
      const automation = await db.automation.findFirst({ where: { id: input.automationId, tenantId: user.tenantId } });
      if (!automation || !["refresh-agent", "inventory-refresh"].includes(automation.key) || !canRunAutomation(user.permissionKeys, automation.approved, automation.riskLevel, input.confirmed)) throw new AuthorizationError("This action is not approved for the live agent allowlist.");
      const credential = await db.agentCredential.findFirst({ where: { deviceId: device.id, revokedAt: null } });
      if (!credential) throw new Error("The endpoint has no active live-agent credential.");
      const run = await db.automationRun.create({ data: { automationId: automation.id, deviceId: device.id, requestedById: user.id, triggerSource: "on-demand", status: "queued", input: "{}", output: "Awaiting authenticated live agent pickup." } });
      await audit(user, request, "automation.queued", "AutomationRun", run.id, device.organizationId, null, { automation: automation.key, device: device.hostname, status: "queued" });
      return NextResponse.json({ ok: true, run });
    }
    if (input.action === "updateAlert") {
      assertPermission(user, "alert.manage");
      const alert = await db.alert.findFirst({ where: { id: input.alertId, tenantId: user.tenantId } });
      if (!alert) throw new Error("Alert was not found.");
      assertOrganization(user, alert.organizationId);
      const update = input.status === "acknowledged" ? { status: input.status, acknowledgedAt: new Date(), notes: input.note || alert.notes } : input.status === "resolved" ? { status: input.status, resolvedAt: new Date(), notes: input.note || alert.notes } : { status: input.status, suppressedUntil: new Date(Date.now() + 4 * 3_600_000), notes: input.note || alert.notes };
      await db.alert.update({ where: { id: alert.id }, data: update });
      await audit(user, request, `alert.${input.status}`, "Alert", alert.id, alert.organizationId, { status: alert.status }, { status: input.status });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "updateTicket") {
      assertPermission(user, "ticket.manage");
      const ticket = await db.ticket.findFirst({ where: { id: input.ticketId, tenantId: user.tenantId } });
      if (!ticket) throw new Error("Ticket was not found.");
      assertOrganization(user, ticket.organizationId);
      const updated = await db.ticket.update({ where: { id: ticket.id }, data: { status: input.status, resolvedAt: input.status === "resolved" ? new Date() : ticket.resolvedAt, closedAt: input.status === "closed" ? new Date() : ticket.closedAt, ...(input.comment ? { comments: { create: { authorId: user.id, body: input.comment } } } : {}) } });
      await audit(user, request, "ticket.updated", "Ticket", ticket.id, ticket.organizationId, { status: ticket.status }, { status: updated.status });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "patchAction") {
      assertPermission(user, "patch.manage");
      const patch = await db.patch.findFirst({ where: { id: input.patchId, tenantId: user.tenantId } });
      if (!patch) throw new Error("Patch was not found.");
      const approvalState = input.operation === "approve" ? "approved" : input.operation === "reject" ? "rejected" : input.operation === "testing" ? "testing" : patch.approvalState;
      await db.patch.update({ where: { id: patch.id }, data: { approvalState, scheduledFor: input.operation === "schedule" ? new Date(Date.now() + 86_400_000) : patch.scheduledFor } });
      await audit(user, request, `patch.${input.operation}`, "Patch", patch.id, null, { approvalState: patch.approvalState }, { approvalState });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Some submitted values were invalid.", details: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The operation could not be completed." }, { status: error instanceof AuthorizationError ? 403 : 400 });
  }
}
