import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { hashAgentSecret } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { canRunAutomation } from "@/lib/domain";
import { clientAddress } from "@/lib/login-rate-limit";
import { assertOrganization, assertPermission, AuthorizationError, type SessionUser } from "@/lib/rbac";
import { isTrustedBrowserOrigin } from "@/lib/request-origin";

const id = z.string().min(1).max(80);
const optionalId = z.union([id, z.literal("")]).optional();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createOrganization"), name: z.string().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]+$/).max(80), industry: z.string().max(80).optional() }),
  z.object({ action: z.literal("createLocation"), organizationId: id, name: z.string().min(2).max(100), address: z.string().max(200).optional() }),
  z.object({ action: z.literal("createPolicy"), name: z.string().min(3).max(100), description: z.string().max(300), organizationId: optionalId, parentId: optionalId }),
  z.object({ action: z.literal("createEnrollmentToken"), organizationId: id, locationId: id, name: z.string().min(2).max(100), expiresInHours: z.coerce.number().int().min(1).max(168).default(24), maxUses: z.coerce.number().int().min(1).max(100).default(1) }),
  z.object({ action: z.literal("revokeEnrollmentToken"), tokenId: id }),
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
