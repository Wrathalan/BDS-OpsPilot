import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentRequestContext, hashAgentSecret } from "@/lib/agent-auth";

const schema = z.object({
  token: z.string().min(32).max(180),
  hostname: z.string().regex(/^[A-Za-z0-9._-]+$/).max(128),
  displayName: z.string().min(1).max(160),
  role: z.string().min(1).max(80).default("Endpoint"),
  operatingSystem: z.string().min(1).max(120),
  osVersion: z.string().min(1).max(160),
  manufacturer: z.string().max(120).default("Unknown"),
  model: z.string().max(120).default("Unknown"),
  serialNumber: z.string().max(160).default("Unknown"),
  cpu: z.string().max(240),
  memoryGb: z.number().int().positive().max(65_536),
  diskCapacityGb: z.number().int().nonnegative().max(10_000_000),
  diskUsedPercent: z.number().min(0).max(100),
  ipAddress: z.string().max(80),
  lastLoggedInUser: z.string().max(160),
  agentVersion: z.string().min(1).max(40),
  uptimeMinutes: z.number().int().nonnegative(),
});

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  const context = agentRequestContext(request);
  const current = attempts.get(context);
  if (current && current.resetAt > Date.now() && current.count >= 10) return NextResponse.json({ error: "Enrollment rate limit exceeded." }, { status: 429 });
  try {
    const input = schema.parse(await request.json());
    const enrollment = await db.enrollmentToken.findUnique({ where: { tokenHash: hashAgentSecret(input.token) } });
    if (!enrollment || enrollment.revokedAt || enrollment.expiresAt <= new Date() || enrollment.uses >= enrollment.maxUses) {
      attempts.set(context, { count: (current?.resetAt ?? 0) > Date.now() ? current!.count + 1 : 1, resetAt: Date.now() + 15 * 60_000 });
      return NextResponse.json({ error: "Enrollment token is invalid, expired, revoked, or fully used." }, { status: 401 });
    }
    const location = await db.location.findFirst({ where: { id: enrollment.locationId, organizationId: enrollment.organizationId }, include: { organization: true } });
    if (!location || location.organization.tenantId !== enrollment.tenantId) return NextResponse.json({ error: "Enrollment scope is no longer valid." }, { status: 409 });

    const agentSecret = `ops_agent_${randomBytes(32).toString("base64url")}`;
    const device = await db.$transaction(async (tx) => {
      const endpoint = await tx.device.upsert({
        where: { tenantId_hostname: { tenantId: enrollment.tenantId, hostname: input.hostname.toUpperCase() } },
        update: { organizationId: enrollment.organizationId, locationId: enrollment.locationId, displayName: input.displayName, role: input.role, status: "online", operatingSystem: input.operatingSystem, osVersion: input.osVersion, manufacturer: input.manufacturer, model: input.model, serialNumber: input.serialNumber, cpu: input.cpu, memoryGb: input.memoryGb, diskCapacityGb: input.diskCapacityGb, diskUsedPercent: input.diskUsedPercent, ipAddress: input.ipAddress, lastLoggedInUser: input.lastLoggedInUser, agentVersion: input.agentVersion, lastCheckIn: new Date(), uptimeMinutes: input.uptimeMinutes, managementMode: "agent" },
        create: { tenantId: enrollment.tenantId, organizationId: enrollment.organizationId, locationId: enrollment.locationId, hostname: input.hostname.toUpperCase(), displayName: input.displayName, role: input.role, status: "online", operatingSystem: input.operatingSystem, osVersion: input.osVersion, manufacturer: input.manufacturer, model: input.model, serialNumber: input.serialNumber, cpu: input.cpu, memoryGb: input.memoryGb, diskCapacityGb: input.diskCapacityGb, diskUsedPercent: input.diskUsedPercent, ipAddress: input.ipAddress, lastLoggedInUser: input.lastLoggedInUser, agentVersion: input.agentVersion, lastCheckIn: new Date(), uptimeMinutes: input.uptimeMinutes, managementMode: "agent" },
      });
      await tx.agentCredential.updateMany({ where: { deviceId: endpoint.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.agentCredential.create({ data: { deviceId: endpoint.id, secretHash: hashAgentSecret(agentSecret), secretPrefix: agentSecret.slice(0, 18) } });
      await tx.agentSession.updateMany({ where: { deviceId: endpoint.id, type: "telemetry", status: "active" }, data: { status: "ended", endedAt: new Date() } });
      await tx.agentSession.create({ data: { deviceId: endpoint.id, type: "telemetry", status: "active", requestedBy: "Endpoint enrollment" } });
      await tx.enrollmentToken.update({ where: { id: enrollment.id }, data: { uses: { increment: 1 } } });
      await tx.auditEvent.create({ data: { tenantId: enrollment.tenantId, organizationId: enrollment.organizationId, action: "agent.enrolled", resourceType: "Device", resourceId: endpoint.id, requestContext: context, afterSummary: JSON.stringify({ hostname: endpoint.hostname, agentVersion: endpoint.agentVersion, tokenPrefix: enrollment.tokenPrefix }) } });
      return endpoint;
    });
    attempts.delete(context);
    return NextResponse.json({ deviceId: device.id, agentSecret, checkInUrl: "/api/agent/check-in", taskUrl: "/api/agent/tasks", intervalSeconds: 60 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Enrollment payload was invalid.", details: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enrollment failed." }, { status: 500 });
  }
}
