import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { alertFingerprint, canRunAutomation, shouldCreateAlert, transitionPatchState } from "@/lib/domain";
import { assertOrganization, assertPermission, AuthorizationError, type SessionUser } from "@/lib/rbac";

const id = z.string().min(1).max(80);
const optionalId = z.union([id, z.literal("")]).optional();
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createOrganization"), name: z.string().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]+$/).max(80), industry: z.string().max(80).optional() }),
  z.object({ action: z.literal("createLocation"), organizationId: id, name: z.string().min(2).max(100), address: z.string().max(200).optional() }),
  z.object({ action: z.literal("createPolicy"), name: z.string().min(3).max(100), description: z.string().max(300), organizationId: optionalId, parentId: optionalId }),
  z.object({ action: z.literal("generateDevice"), organizationId: id, locationId: id, hostname: z.string().regex(/^[A-Za-z0-9-]+$/).max(64), displayName: z.string().min(2).max(100), operatingSystem: z.string().max(80).default("Windows 11 Pro") }),
  z.object({ action: z.literal("simulateCondition"), deviceId: id, condition: z.enum(["service_stopped", "missing_patch", "pending_reboot", "prohibited_software", "offline"]) }),
  z.object({ action: z.literal("runAutomation"), deviceId: id, automationId: id, alertId: id.optional(), confirmed: z.boolean().optional() }),
  z.object({ action: z.literal("updateAlert"), alertId: id, status: z.enum(["acknowledged", "suppressed", "resolved"]), note: z.string().max(500).optional() }),
  z.object({ action: z.literal("updateTicket"), ticketId: id, status: z.enum(["new", "open", "waiting_on_user", "resolved", "closed"]), comment: z.string().max(1000).optional() }),
  z.object({ action: z.literal("patchAction"), patchId: id, operation: z.enum(["approve", "reject", "testing", "schedule", "install"]), deviceIds: z.array(id).max(100).optional() }),
  z.object({ action: z.literal("requestSession"), deviceId: id, approvedBy: z.string().max(100).optional() }),
  z.object({ action: z.literal("endSession"), sessionId: id }),
  z.object({ action: z.literal("simulatorPulse") }),
  z.object({ action: z.literal("setSimulator"), deviceId: id, state: z.enum(["running", "stopped", "online", "offline"]) }),
]);

function requestContext(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local-browser";
}

function validateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(process.env.APP_URL ?? "http://127.0.0.1:3000").origin;
  if (origin !== expected && origin !== "http://localhost:3000") throw new AuthorizationError("Request origin was not accepted.");
}

async function audit(user: SessionUser, request: Request, action: string, resourceType: string, resourceId: string, organizationId?: string | null, beforeSummary?: unknown, afterSummary?: unknown, success = true) {
  await db.auditEvent.create({ data: { tenantId: user.tenantId, organizationId, actorId: user.id, action, resourceType, resourceId, requestContext: requestContext(request), beforeSummary: beforeSummary === undefined ? null : JSON.stringify(beforeSummary), afterSummary: afterSummary === undefined ? null : JSON.stringify(afterSummary), success } });
}

async function scopedDevice(user: SessionUser, deviceId: string) {
  const device = await db.device.findFirst({ where: { id: deviceId, tenantId: user.tenantId }, include: { organization: true } });
  if (!device) throw new Error("Device was not found.");
  assertOrganization(user, device.organizationId);
  return device;
}

async function nextTicketNumber(tenantId: string) {
  const latest = await db.ticket.findFirst({ where: { tenantId }, orderBy: { number: "desc" } });
  return (latest?.number ?? 1000) + 1;
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
      const location = await db.location.create({ data: { organizationId: input.organizationId, name: input.name, address: input.address || null } });
      await audit(user, request, "location.created", "Location", location.id, input.organizationId, null, { name: location.name });
      return NextResponse.json({ ok: true, location });
    }
    if (input.action === "createPolicy") {
      assertPermission(user, "tenant.manage");
      if (input.organizationId) assertOrganization(user, input.organizationId);
      const policy = await db.policy.create({ data: { tenantId: user.tenantId, parentId: input.parentId || null, name: input.name, description: input.description, settings: JSON.stringify({ cpuThreshold: 85, memoryThreshold: 90, patchMode: "approve-critical", maintenanceWindow: "Sat 22:00-02:00", rebootBehavior: "defer-2x", requiredSoftware: ["OpsPilot Agent"], prohibitedSoftware: [], notifications: ["in-app"] }), conditions: { create: [{ type: "service_stopped", comparator: "=", threshold: 0, durationMinutes: 1, severity: "critical", automationKey: "restart-service", createTicket: true }] } } });
      if (input.organizationId) await db.policyAssignment.create({ data: { policyId: policy.id, organizationId: input.organizationId } });
      await audit(user, request, "policy.created", "Policy", policy.id, input.organizationId, null, { name: policy.name, assigned: Boolean(input.organizationId) });
      return NextResponse.json({ ok: true, policy });
    }
    if (input.action === "generateDevice") {
      assertPermission(user, "device.manage");
      assertOrganization(user, input.organizationId);
      const location = await db.location.findFirst({ where: { id: input.locationId, organizationId: input.organizationId } });
      if (!location) throw new Error("Location does not belong to the selected organization.");
      const device = await db.device.create({ data: { tenantId: user.tenantId, organizationId: input.organizationId, locationId: input.locationId, hostname: input.hostname.toUpperCase(), displayName: input.displayName, role: input.operatingSystem.includes("Server") ? "Server" : "Workstation", status: "online", operatingSystem: input.operatingSystem, osVersion: input.operatingSystem.includes("Windows") ? "24H2 (26100.4652)" : "24.04.2 LTS", manufacturer: "Simulated Hardware", model: "OpsPilot Virtual Endpoint", serialNumber: `SIM-${Date.now().toString().slice(-8)}`, cpu: "Simulated 8-core CPU", memoryGb: 16, diskCapacityGb: 512, diskUsedPercent: 42, ipAddress: `10.99.0.${20 + Math.floor(Math.random() * 180)}`, lastLoggedInUser: "demo.user", agentVersion: "4.9.3", lastCheckIn: new Date(), uptimeMinutes: 12, patchCompliance: 100, customFields: JSON.stringify({ serviceState: "running", simulated: true }), hardwareInventory: { create: { biosVersion: "SIM-1.0", tpmVersion: "2.0", cpuCores: 8, macAddress: `02:00:00:${Math.floor(Math.random() * 99)}:26:07` } }, softwareInventory: { create: [{ name: "OpsPilot Agent", version: "4.9.3", vendor: "Northstar Labs", required: true }] }, agentSessions: { create: { type: "telemetry", status: "active", requestedBy: user.name, simulatorOnly: true } } } });
      await audit(user, request, "device.enrolled", "Device", device.id, input.organizationId, null, { hostname: device.hostname, simulatorOnly: true });
      return NextResponse.json({ ok: true, device });
    }
    if (input.action === "simulateCondition") {
      assertPermission(user, "device.manage");
      const device = await scopedDevice(user, input.deviceId);
      const titles = { service_stopped: "Print Spooler service stopped", missing_patch: "Critical patch is missing", pending_reboot: "Pending reboot exceeds policy", prohibited_software: "Prohibited software detected", offline: "Agent has not checked in" };
      const fingerprint = alertFingerprint(device.id, input.condition);
      const open = await db.alert.findMany({ where: { tenantId: user.tenantId, fingerprint, status: { notIn: ["resolved", "closed"] } } });
      let alert = open[0];
      const fields = JSON.parse(device.customFields || "{}");
      if (input.condition === "service_stopped") fields.serviceState = "stopped";
      await db.device.update({ where: { id: device.id }, data: { status: input.condition === "offline" ? "offline" : "critical", simulatorState: input.condition === "offline" ? "stopped" : device.simulatorState, pendingReboot: input.condition === "pending_reboot" ? true : device.pendingReboot, customFields: JSON.stringify(fields), activeAlertCount: { increment: shouldCreateAlert(open, fingerprint) ? 1 : 0 }, lastCheckIn: input.condition === "offline" ? new Date(Date.now() - 3_600_000) : new Date() } });
      if (shouldCreateAlert(open, fingerprint)) {
        alert = await db.alert.create({ data: { tenantId: user.tenantId, organizationId: device.organizationId, deviceId: device.id, fingerprint, title: titles[input.condition], description: `A simulator-only ${input.condition.replaceAll("_", " ")} condition was triggered for workflow validation.`, severity: input.condition === "missing_patch" || input.condition === "pending_reboot" ? "warning" : "critical", priority: input.condition === "offline" ? "high" : "urgent", history: JSON.stringify([{ at: new Date().toISOString(), event: "Condition triggered", actor: user.name }]) } });
        const ticket = await db.ticket.create({ data: { tenantId: user.tenantId, organizationId: device.organizationId, deviceId: device.id, alertId: alert.id, requester: "OpsPilot policy engine", number: await nextTicketNumber(user.tenantId), title: alert.title, description: alert.description, status: "new", priority: alert.priority, category: "Monitoring", slaTarget: new Date(Date.now() + 4 * 3_600_000) } });
        await db.notification.create({ data: { tenantId: user.tenantId, userId: user.id, type: "alert", title: alert.title, body: `${device.hostname} triggered a simulated ${alert.severity} condition.` } });
        await audit(user, request, "condition.simulated", "Alert", alert.id, device.organizationId, null, { device: device.hostname, ticket: ticket.number, simulatorOnly: true });
      }
      return NextResponse.json({ ok: true, alert, deduplicated: open.length > 0 });
    }
    if (input.action === "runAutomation") {
      assertPermission(user, "automation.run");
      const device = await scopedDevice(user, input.deviceId);
      const automation = await db.automation.findFirst({ where: { id: input.automationId, tenantId: user.tenantId } });
      if (!automation || !canRunAutomation(user.permissionKeys, automation.approved, automation.riskLevel, input.confirmed)) throw new AuthorizationError("This automation is not approved for your role or requires confirmation.");
      const run = await db.automationRun.create({ data: { automationId: automation.id, deviceId: device.id, requestedById: user.id, alertId: input.alertId || null, triggerSource: input.alertId ? "alert" : "on-demand", status: "running", startedAt: new Date(), input: JSON.stringify({ confirmed: Boolean(input.confirmed) }) } });
      const fields = JSON.parse(device.customFields || "{}");
      if (automation.key === "restart-service") fields.serviceState = "running";
      if (automation.key === "clear-temp-files") await db.device.update({ where: { id: device.id }, data: { diskUsedPercent: Math.max(8, device.diskUsedPercent - 7) } });
      if (automation.key === "request-reboot") await db.device.update({ where: { id: device.id }, data: { pendingReboot: true } });
      if (automation.key === "refresh-agent") await db.device.update({ where: { id: device.id }, data: { lastCheckIn: new Date(), status: "online", simulatorState: "running" } });
      if (automation.key === "restart-service") {
        const affected = await db.alert.findMany({ where: { deviceId: device.id, fingerprint: alertFingerprint(device.id, "service_stopped"), status: { notIn: ["resolved", "closed"] } }, include: { ticket: true } });
        await db.alert.updateMany({ where: { id: { in: affected.map((alert) => alert.id) } }, data: { status: "resolved", resolvedAt: new Date(), notes: "Condition cleared after approved simulated restart-service automation." } });
        for (const alert of affected) if (alert.ticket && alert.ticket.status !== "closed") await db.ticket.update({ where: { id: alert.ticket.id }, data: { status: "resolved", resolvedAt: new Date() } });
        await db.device.update({ where: { id: device.id }, data: { customFields: JSON.stringify(fields), status: "online", activeAlertCount: { decrement: Math.min(device.activeAlertCount, affected.length) }, lastCheckIn: new Date() } });
      }
      const completed = await db.automationRun.update({ where: { id: run.id }, data: { status: "succeeded", completedAt: new Date(), output: `Simulated executor completed “${automation.name}”. No real endpoint command was executed.` } });
      await audit(user, request, "automation.executed", "AutomationRun", run.id, device.organizationId, null, { automation: automation.key, device: device.hostname, result: "succeeded", simulatorOnly: true });
      return NextResponse.json({ ok: true, run: completed });
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
      await audit(user, request, "ticket.updated", "Ticket", ticket.id, ticket.organizationId, { status: ticket.status }, { status: updated.status, activeConditionUnaffected: input.status === "closed" });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "patchAction") {
      assertPermission(user, "patch.manage");
      const patch = await db.patch.findFirst({ where: { id: input.patchId, tenantId: user.tenantId } });
      if (!patch) throw new Error("Patch was not found.");
      if (input.operation !== "install") {
        const approvalState = input.operation === "approve" ? "approved" : input.operation === "reject" ? "rejected" : input.operation === "testing" ? "testing" : patch.approvalState;
        await db.patch.update({ where: { id: patch.id }, data: { approvalState, scheduledFor: input.operation === "schedule" ? new Date(Date.now() + 86_400_000) : patch.scheduledFor } });
      } else {
        if (patch.approvalState !== "approved") throw new Error("Approve the patch before installation.");
        const states = await db.devicePatchState.findMany({ where: { patchId: patch.id, ...(input.deviceIds?.length ? { deviceId: { in: input.deviceIds } } : {}), device: { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) } } });
        for (const state of states) {
          const installing = ["missing", "failed", "scheduled"].includes(state.state) ? transitionPatchState(state.state, "installing") : state.state;
          if (installing === "installing") await db.devicePatchState.update({ where: { id: state.id }, data: { state: "installed", lastAttemptAt: new Date(), installedAt: new Date(), failureReason: null } });
        }
      }
      await audit(user, request, `patch.${input.operation}`, "Patch", patch.id, null, { approvalState: patch.approvalState }, { operation: input.operation, simulatorOnly: true });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "requestSession") {
      assertPermission(user, "device.manage");
      const device = await scopedDevice(user, input.deviceId);
      const session = await db.agentSession.create({ data: { deviceId: device.id, type: "diagnostic", status: input.approvedBy ? "active" : "awaiting_user_approval", requestedBy: user.name, approvedBy: input.approvedBy || null, simulatorOnly: true } });
      await audit(user, request, "diagnostic.requested", "AgentSession", session.id, device.organizationId, null, { approvedBy: input.approvedBy || null, simulatorOnly: true });
      return NextResponse.json({ ok: true, session });
    }
    if (input.action === "endSession") {
      assertPermission(user, "device.manage");
      const session = await db.agentSession.findUnique({ where: { id: input.sessionId }, include: { device: true } });
      if (!session || session.device.tenantId !== user.tenantId) throw new Error("Session was not found.");
      assertOrganization(user, session.device.organizationId);
      await db.agentSession.update({ where: { id: session.id }, data: { status: "ended", endedAt: new Date() } });
      await audit(user, request, "diagnostic.ended", "AgentSession", session.id, session.device.organizationId, null, { simulatorOnly: true });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "setSimulator") {
      assertPermission(user, "device.manage");
      const device = await scopedDevice(user, input.deviceId);
      const online = input.state === "running" || input.state === "online";
      await db.device.update({ where: { id: device.id }, data: { simulatorState: online ? "running" : "stopped", status: online ? "online" : "offline", lastCheckIn: online ? new Date() : device.lastCheckIn } });
      await audit(user, request, "simulator.state_changed", "Device", device.id, device.organizationId, { state: device.simulatorState }, { state: online ? "running" : "stopped" });
      return NextResponse.json({ ok: true });
    }
    if (input.action === "simulatorPulse") {
      assertPermission(user, "device.manage");
      const devices = await db.device.findMany({ where: { tenantId: user.tenantId, simulatorState: "running", ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) }, take: 60 });
      await db.$transaction(devices.map((device, index) => db.deviceMetric.create({ data: { deviceId: device.id, cpu: 15 + ((Date.now() / 1000 + index * 17) % 73), memory: 35 + ((Date.now() / 1200 + index * 11) % 55), disk: device.diskUsedPercent, latencyMs: 16 + (index * 13) % 120 } })));
      await db.device.updateMany({ where: { id: { in: devices.map((device) => device.id) } }, data: { lastCheckIn: new Date() } });
      return NextResponse.json({ ok: true, updated: devices.length });
    }
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Some submitted values were invalid.", details: error.issues }, { status: 400 });
    const status = error instanceof AuthorizationError ? 403 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "The operation could not be completed." }, { status });
  }
}
