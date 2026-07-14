import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { toCsv } from "@/lib/domain";

export async function GET(_: Request, { params }: { params: Promise<{ report: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.permissionKeys.includes("report.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { report } = await params;
  const deviceWhere = { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) };
  let rows: Record<string, unknown>[];
  if (report === "device-inventory.csv") {
    const devices = await db.device.findMany({ where: deviceWhere, include: { organization: true, location: true }, orderBy: { hostname: "asc" } });
    rows = devices.map((device) => ({ Hostname: device.hostname, Name: device.displayName, Organization: device.organization.name, Location: device.location.name, Status: device.status, OS: device.operatingSystem, Version: device.osVersion, IP: device.ipAddress, Agent: device.agentVersion, "Patch compliance": `${device.patchCompliance}%`, "Last check-in": device.lastCheckIn.toISOString() }));
  } else if (report === "patch-compliance.csv") {
    const devices = await db.device.findMany({ where: deviceWhere, include: { organization: true }, orderBy: { patchCompliance: "asc" } });
    rows = devices.map((device) => ({ Hostname: device.hostname, Organization: device.organization.name, Compliance: `${device.patchCompliance}%`, "Pending reboot": device.pendingReboot ? "Yes" : "No", Status: device.status }));
  } else if (report === "audit-history.csv") {
    const events = await db.auditEvent.findMany({ where: { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { OR: [{ organizationId: null }, { organizationId: { in: user.organizationIds } }] }) }, include: { actor: true, organization: true }, orderBy: { createdAt: "desc" } });
    rows = events.map((event) => ({ Time: event.createdAt.toISOString(), Actor: event.actor?.name ?? "System", Action: event.action, Resource: `${event.resourceType}:${event.resourceId}`, Organization: event.organization?.name ?? "Tenant-wide", Result: event.success ? "Success" : "Failure" }));
  } else return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  return new NextResponse(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${report}"`, "Cache-Control": "no-store" } });
}
