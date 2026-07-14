import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAgent, agentRequestContext } from "@/lib/agent-auth";
import { db } from "@/lib/db";
import { alertFingerprint, shouldCreateAlert } from "@/lib/domain";

const schema = z.object({
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  diskUsedPercent: z.number().min(0).max(100),
  diskCapacityGb: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative().max(600_000).default(0),
  uptimeMinutes: z.number().int().nonnegative(),
  pendingReboot: z.boolean().default(false),
  agentVersion: z.string().min(1).max(40),
  ipAddress: z.string().max(80),
  lastLoggedInUser: z.string().max(160),
  hardware: z.object({ biosVersion: z.string().max(120), tpmVersion: z.string().max(80).nullable().optional(), cpuCores: z.number().int().positive().max(4096), macAddress: z.string().max(80) }).optional(),
  software: z.array(z.object({ name: z.string().min(1).max(200), version: z.string().max(120), vendor: z.string().max(160) })).max(5000).optional(),
});

async function evaluateThreshold(device: { id: string; tenantId: string; organizationId: string }, type: string, active: boolean, title: string, description: string, severity: string) {
  const fingerprint = alertFingerprint(device.id, type);
  const unresolved = await db.alert.findMany({ where: { tenantId: device.tenantId, fingerprint, status: { notIn: ["resolved", "closed"] } } });
  if (active && shouldCreateAlert(unresolved, fingerprint)) {
    await db.alert.create({ data: { tenantId: device.tenantId, organizationId: device.organizationId, deviceId: device.id, fingerprint, title, description, severity, priority: severity === "critical" ? "urgent" : "normal", history: JSON.stringify([{ at: new Date().toISOString(), event: "Live telemetry threshold crossed", actor: "Agent gateway" }]) } });
  } else if (!active && unresolved.length) {
    await db.alert.updateMany({ where: { id: { in: unresolved.map((alert) => alert.id) } }, data: { status: "resolved", resolvedAt: new Date(), notes: "Live telemetry returned within threshold." } });
  }
}

export async function POST(request: Request) {
  const credential = await authenticateAgent(request);
  if (!credential) return NextResponse.json({ error: "Agent authentication failed." }, { status: 401 });
  try {
    const input = schema.parse(await request.json());
    const started = Date.now();
    await db.$transaction(async (tx) => {
      await tx.device.update({ where: { id: credential.deviceId }, data: { status: "online", lastCheckIn: new Date(), uptimeMinutes: input.uptimeMinutes, pendingReboot: input.pendingReboot, agentVersion: input.agentVersion, ipAddress: input.ipAddress, lastLoggedInUser: input.lastLoggedInUser, diskUsedPercent: input.diskUsedPercent, ...(input.diskCapacityGb !== undefined ? { diskCapacityGb: input.diskCapacityGb } : {}) } });
      await tx.deviceMetric.create({ data: { deviceId: credential.deviceId, cpu: input.cpu, memory: input.memory, disk: input.diskUsedPercent, latencyMs: input.latencyMs } });
      if (input.hardware) await tx.hardwareInventory.upsert({ where: { deviceId: credential.deviceId }, update: { ...input.hardware, tpmVersion: input.hardware.tpmVersion ?? null, collectedAt: new Date() }, create: { deviceId: credential.deviceId, ...input.hardware, tpmVersion: input.hardware.tpmVersion ?? null } });
      if (input.software) {
        await tx.softwareInventoryItem.deleteMany({ where: { deviceId: credential.deviceId } });
        if (input.software.length) await tx.softwareInventoryItem.createMany({ data: input.software.map((item) => ({ deviceId: credential.deviceId, ...item })) });
      }
    });
    const device = credential.device;
    await evaluateThreshold(device, "cpu_high", input.cpu > 90, "CPU utilization above 90%", `Live agent reported ${input.cpu.toFixed(1)}% CPU utilization.`, "warning");
    await evaluateThreshold(device, "memory_high", input.memory > 90, "Memory utilization above 90%", `Live agent reported ${input.memory.toFixed(1)}% memory utilization.`, "warning");
    await evaluateThreshold(device, "disk_low", input.diskUsedPercent > 90, "Disk free space below 10%", `Live agent reported ${input.diskUsedPercent.toFixed(1)}% disk utilization.`, "critical");
    const unresolvedAlerts = await db.alert.findMany({ where: { deviceId: device.id, status: { notIn: ["resolved", "closed"] } }, select: { severity: true } });
    await db.device.update({ where: { id: device.id }, data: { activeAlertCount: unresolvedAlerts.length, status: unresolvedAlerts.some((alert) => alert.severity === "critical") ? "critical" : unresolvedAlerts.length ? "warning" : "online" } });
    await db.auditEvent.create({ data: { tenantId: device.tenantId, organizationId: device.organizationId, action: "agent.check_in", resourceType: "Device", resourceId: device.id, requestContext: agentRequestContext(request), afterSummary: JSON.stringify({ cpu: input.cpu, memory: input.memory, disk: input.diskUsedPercent, processingMs: Date.now() - started }) } });
    return NextResponse.json({ ok: true, serverTime: new Date().toISOString(), nextCheckInSeconds: 60 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Check-in payload was invalid.", details: error.issues }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Check-in failed." }, { status: 500 });
  }
}
