import { db } from "./db";
import type { SessionUser } from "./rbac";
import { resolveEffectivePolicy, type PolicyNode } from "./domain";

const dateLabel = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const safeJson = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export async function getConsoleData(user: SessionUser) {
  const organizationWhere = user.allOrganizations ? { tenantId: user.tenantId } : { tenantId: user.tenantId, id: { in: user.organizationIds } };
  const deviceWhere = user.allOrganizations ? { tenantId: user.tenantId } : { tenantId: user.tenantId, organizationId: { in: user.organizationIds } };
  const [organizations, devices, alerts, patches, automations, automationRuns, tickets, policies, users, auditEvents, reports, notifications, metrics, enrollmentTokens, technicianInvites] = await Promise.all([
    db.organization.findMany({
      where: organizationWhere,
      include: {
        locations: { include: { _count: { select: { devices: true } } } },
        _count: { select: { devices: true, alerts: { where: { status: { not: "resolved" } } }, tickets: { where: { status: { notIn: ["resolved", "closed"] } } } } },
      },
      orderBy: { name: "asc" },
    }),
    db.device.findMany({
      where: deviceWhere,
      include: { organization: true, location: true, softwareInventory: true, _count: { select: { alerts: { where: { status: { not: "resolved" } } } } } },
      orderBy: [{ status: "asc" }, { hostname: "asc" }],
    }),
    db.alert.findMany({ where: { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) }, include: { device: true, organization: true, assignee: true, ticket: true }, orderBy: { triggeredAt: "desc" }, take: 100 }),
    db.patch.findMany({ where: { tenantId: user.tenantId }, include: { deviceStates: { where: { device: deviceWhere }, include: { device: true } } }, orderBy: { releaseDate: "desc" } }),
    db.automation.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: "asc" } }),
    db.automationRun.findMany({ where: { device: deviceWhere }, include: { automation: true, device: true, requestedBy: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.ticket.findMany({ where: { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) }, include: { organization: true, device: true, assignee: true, alert: true, comments: true }, orderBy: { updatedAt: "desc" }, take: 80 }),
    db.policy.findMany({ where: { tenantId: user.tenantId }, include: { parent: true, assignments: { include: { organization: true, location: true, device: true } }, conditions: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { tenantId: user.tenantId }, include: { role: true, scopes: { include: { organization: true } } }, orderBy: { name: "asc" } }),
    db.auditEvent.findMany({ where: { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { OR: [{ organizationId: null }, { organizationId: { in: user.organizationIds } }] }) }, include: { actor: true, organization: true }, orderBy: { createdAt: "desc" }, take: 120 }),
    db.reportDefinition.findMany({ where: { tenantId: user.tenantId }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } }, orderBy: { name: "asc" } }),
    db.notification.findMany({ where: { tenantId: user.tenantId, OR: [{ userId: null }, { userId: user.id }] }, orderBy: { createdAt: "desc" }, take: 12 }),
    db.deviceMetric.findMany({ where: { device: deviceWhere, timestamp: { gte: new Date(Date.now() - 30 * 86_400_000) } }, orderBy: { timestamp: "asc" } }),
    db.enrollmentToken.findMany({ where: { tenantId: user.tenantId, ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) }, include: { organization: true, location: true, createdBy: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    user.permissionKeys.includes("tenant.manage")
      ? db.technicianInvite.findMany({ where: { tenantId: user.tenantId }, include: { role: true, createdBy: true, organizationScopes: { include: { organization: true } } }, orderBy: { createdAt: "desc" }, take: 100 })
      : Promise.resolve([]),
  ]);

  const statusCounts = {
    online: devices.filter((device) => device.status === "online").length,
    warning: devices.filter((device) => device.status === "warning").length,
    critical: devices.filter((device) => device.status === "critical").length,
    offline: devices.filter((device) => device.status === "offline").length,
  };
  const activeAlerts = alerts.filter((alert) => !["resolved", "closed"].includes(alert.status));
  const openTickets = tickets.filter((ticket) => !["resolved", "closed"].includes(ticket.status));
  const patchCompliance = devices.length ? Math.round(devices.reduce((sum, device) => sum + device.patchCompliance, 0) / devices.length) : 0;
  const successfulRuns = automationRuns.filter((run) => run.status === "succeeded").length;
  const trend = Array.from({ length: 14 }, (_, offset) => {
    const date = new Date(Date.now() - (13 - offset) * 86_400_000);
    const key = date.toISOString().slice(0, 10);
    const dayAlerts = alerts.filter((alert) => alert.triggeredAt.toISOString().slice(0, 10) === key).length;
    const dayMetrics = metrics.filter((metric) => metric.timestamp.toISOString().slice(0, 10) === key);
    return { label: dateLabel(date), alerts: dayAlerts, health: dayMetrics.length ? Math.round(100 - dayMetrics.reduce((sum, metric) => sum + Math.max(0, metric.cpu - 75) / 5, 0) / dayMetrics.length) : 98 };
  });
  const osBreakdown = Object.entries(devices.reduce<Record<string, number>>((acc, device) => { const os = device.operatingSystem.split(" ")[0]; acc[os] = (acc[os] ?? 0) + 1; return acc; }, {})).map(([name, count]) => ({ name, count }));

  return safeJson({ generatedAt: new Date(), organizations, devices, alerts, patches, automations, automationRuns, tickets, policies, users, auditEvents, reports, notifications, enrollmentTokens, technicianInvites, trend, osBreakdown, stats: { totalDevices: devices.length, ...statusCounts, activeAlerts: activeAlerts.length, criticalAlerts: activeAlerts.filter((item) => item.severity === "critical").length, warningAlerts: activeAlerts.filter((item) => item.severity === "warning").length, patchCompliance, pendingReboot: devices.filter((item) => item.pendingReboot).length, automationSuccess: automationRuns.length ? Math.round(successfulRuns / automationRuns.length * 100) : 100, openTickets: openTickets.length } });
}

function policyNode(policy: { id: string; name: string; settings: string; parent: { id: string; name: string; settings: string } | null }): PolicyNode {
  return { id: policy.id, name: policy.name, settings: JSON.parse(policy.settings), parent: policy.parent ? { id: policy.parent.id, name: policy.parent.name, settings: JSON.parse(policy.parent.settings) } : null };
}

export async function getDeviceDetail(user: SessionUser, id: string) {
  const device = await db.device.findFirst({ where: { id, tenantId: user.tenantId, ...(user.allOrganizations ? {} : { organizationId: { in: user.organizationIds } }) }, include: { organization: true, location: true, hardwareInventory: true, softwareInventory: true, remoteEndpoints: { orderBy: { provider: "asc" } }, agentCredentials: { where: { revokedAt: null }, select: { id: true, secretPrefix: true, createdAt: true, lastUsedAt: true } }, metrics: { orderBy: { timestamp: "desc" }, take: 30 }, alerts: { include: { ticket: true }, orderBy: { triggeredAt: "desc" } }, automationRuns: { include: { automation: true, requestedBy: true }, orderBy: { createdAt: "desc" }, take: 20 }, patchStates: { include: { patch: true }, orderBy: { patch: { releaseDate: "desc" } } }, agentSessions: { orderBy: { startedAt: "desc" }, take: 12 }, policyAssignments: { include: { policy: { include: { parent: true } } } } } });
  if (!device) return null;
  const hierarchyAssignments = await db.policyAssignment.findMany({ where: { OR: [{ organizationId: device.organizationId }, { locationId: device.locationId }, { deviceId: device.id }] }, include: { policy: { include: { parent: true } } } });
  const candidates = hierarchyAssignments.map((assignment) => ({ level: assignment.deviceId ? "device" as const : assignment.locationId ? "location" as const : "organization" as const, policy: policyNode(assignment.policy) }));
  const effectivePolicy = resolveEffectivePolicy(candidates);
  const approvedAutomations = await db.automation.findMany({ where: { tenantId: user.tenantId, approved: true }, orderBy: { name: "asc" } });
  return safeJson({ device, effectivePolicy, approvedAutomations });
}

export type ConsoleData = Awaited<ReturnType<typeof getConsoleData>>;
export type DeviceDetailData = NonNullable<Awaited<ReturnType<typeof getDeviceDetail>>>;
