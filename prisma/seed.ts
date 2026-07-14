import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const seeded = (index: number, salt = 0) => ((index * 37 + salt * 17) % 97) / 97;

const permissionCatalog = [
  ["tenant.manage", "Manage tenant security and settings"],
  ["organization.manage", "Create and update organizations and locations"],
  ["device.view", "View device inventory and telemetry"],
  ["device.manage", "Enroll devices and update device state"],
  ["alert.manage", "Acknowledge, assign, suppress, and resolve alerts"],
  ["automation.run", "Run approved automation packages"],
  ["patch.manage", "Approve and deploy simulated patches"],
  ["ticket.manage", "Manage service desk tickets"],
  ["report.view", "View and export reports"],
  ["audit.view", "View audit history"],
];

const automations = [
  ["restart-service", "Restart simulated service", "Safely restarts the selected simulated Windows or Linux service."],
  ["clear-temp-files", "Clear simulated temporary files", "Reclaims a simulated amount of endpoint disk capacity."],
  ["inventory-refresh", "Perform inventory refresh", "Requests fresh hardware and software inventory from the simulator."],
  ["patch-scan", "Initiate patch scan", "Refreshes applicable patch state for the selected endpoint."],
  ["install-approved-patch", "Install approved simulated patch", "Installs an approved patch during the simulated maintenance window."],
  ["remove-prohibited-software", "Remove prohibited simulated software", "Removes an inventory item marked prohibited by policy."],
  ["install-required-software", "Install required simulated software", "Adds a required package from the approved catalog."],
  ["request-reboot", "Request simulated reboot", "Queues a user-visible simulated reboot request."],
  ["refresh-agent", "Refresh agent status", "Requests an immediate simulated agent check-in."],
];

async function main() {
  // Delete in dependency order so reseeding remains reliable even after a full
  // alert → ticket → automation workflow has added cross-linked records.
  await prisma.rolePermission.deleteMany();
  await prisma.userOrganizationScope.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.automationRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditEvent.deleteMany();
  await prisma.reportRun.deleteMany();
  await prisma.reportDefinition.deleteMany();
  await prisma.devicePatchState.deleteMany();
  await prisma.patch.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.monitorCondition.deleteMany();
  await prisma.policyAssignment.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.softwareInventoryItem.deleteMany();
  await prisma.hardwareInventory.deleteMany();
  await prisma.deviceMetric.deleteMany();
  await prisma.agentSession.deleteMany();
  await prisma.deviceGroup.deleteMany();
  await prisma.device.deleteMany();
  await prisma.location.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.permission.deleteMany();

  const tenant = await prisma.tenant.create({
    data: { name: "Northstar Managed IT", slug: "northstar" },
  });

  const permissions = new Map<string, string>();
  for (const [key, description] of permissionCatalog) {
    const permission = await prisma.permission.create({ data: { key, description } });
    permissions.set(key, permission.id);
  }

  const roleSpecs = [
    { name: "System Administrator", systemKey: "admin", keys: permissionCatalog.map(([key]) => key) },
    { name: "Technician", systemKey: "technician", keys: ["device.view", "device.manage", "alert.manage", "automation.run", "patch.manage", "ticket.manage", "report.view", "audit.view"] },
    { name: "Read-Only Auditor", systemKey: "auditor", keys: ["device.view", "report.view", "audit.view"] },
  ];
  const roles = new Map<string, string>();
  for (const spec of roleSpecs) {
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: spec.name,
        systemKey: spec.systemKey,
        description: spec.systemKey === "admin" ? "Full tenant administration" : spec.systemKey === "technician" ? "Scoped operations and remediation" : "Read-only compliance access",
        permissions: { create: spec.keys.map((key) => ({ permissionId: permissions.get(key)! })) },
      },
    });
    roles.set(spec.systemKey, role.id);
  }

  const [adminHash, techHash, auditHash] = await Promise.all([
    hash("OpsPilot!2026", 12),
    hash("Technician!2026", 12),
    hash("Auditor!2026", 12),
  ]);
  const admin = await prisma.user.create({ data: { tenantId: tenant.id, roleId: roles.get("admin")!, email: "admin@opspilot.local", name: "Maya Chen", passwordHash: adminHash, allOrganizations: true } });
  const tech = await prisma.user.create({ data: { tenantId: tenant.id, roleId: roles.get("technician")!, email: "tech@opspilot.local", name: "Eli Navarro", passwordHash: techHash } });
  await prisma.user.create({ data: { tenantId: tenant.id, roleId: roles.get("auditor")!, email: "auditor@opspilot.local", name: "Priya Shah", passwordHash: auditHash, allOrganizations: true } });

  const orgSpecs = [
    { name: "Redwood Dental Group", slug: "redwood-dental", industry: "Healthcare", locations: ["Austin Clinic", "Round Rock Clinic", "Cedar Park HQ"] },
    { name: "Kite & Harbor Logistics", slug: "kite-harbor", industry: "Logistics", locations: ["Dallas Operations", "Fort Worth Depot", "Houston Dispatch"] },
    { name: "Blue Mesa Architecture", slug: "blue-mesa", industry: "Professional Services", locations: ["Downtown Studio", "North Design Lab", "Remote Workforce"] },
  ];
  const organizations: { id: string; name: string; locations: { id: string; name: string }[] }[] = [];
  for (const orgSpec of orgSpecs) {
    const org = await prisma.organization.create({
      data: {
        tenantId: tenant.id,
        name: orgSpec.name,
        slug: orgSpec.slug,
        industry: orgSpec.industry,
        locations: { create: orgSpec.locations.map((name, index) => ({ name, address: `${120 + index * 210} Operations Way, TX`, timezone: "America/Chicago" })) },
      },
      include: { locations: true },
    });
    organizations.push({ id: org.id, name: org.name, locations: org.locations.map(({ id, name }) => ({ id, name })) });
  }
  await prisma.userOrganizationScope.createMany({ data: organizations.slice(0, 2).map((organization) => ({ userId: tech.id, organizationId: organization.id })) });

  const basePolicy = await prisma.policy.create({
    data: {
      tenantId: tenant.id,
      name: "Northstar Secure Baseline",
      description: "Tenant-wide monitoring, patching, reboot, and software baseline.",
      settings: JSON.stringify({ cpuThreshold: 88, memoryThreshold: 90, diskFreeThreshold: 12, offlineMinutes: 15, patchMode: "approve-critical", maintenanceWindow: "Sat 22:00-02:00", rebootBehavior: "defer-2x", requiredSoftware: ["OpsPilot Agent", "Sentinel Endpoint"], prohibitedSoftware: ["TorrentBox"], notifications: ["in-app", "ticket-critical"] }),
      conditions: {
        create: [
          { type: "cpu_high", comparator: ">", threshold: 88, durationMinutes: 10, severity: "warning" },
          { type: "disk_low", comparator: "<", threshold: 12, durationMinutes: 5, severity: "critical", createTicket: true },
          { type: "device_offline", comparator: ">", threshold: 15, durationMinutes: 15, severity: "warning" },
          { type: "service_stopped", comparator: "=", threshold: 0, durationMinutes: 1, severity: "critical", automationKey: "restart-service", createTicket: true },
          { type: "patch_compliance_low", comparator: "<", threshold: 90, durationMinutes: 30, severity: "warning" },
          { type: "prohibited_software", comparator: "=", threshold: 1, durationMinutes: 1, severity: "critical", automationKey: "remove-prohibited-software", createTicket: true },
        ],
      },
    },
  });
  const serverPolicy = await prisma.policy.create({ data: { tenantId: tenant.id, parentId: basePolicy.id, name: "Production Server Guardrails", description: "Tighter server thresholds inherited from the secure baseline.", settings: JSON.stringify({ cpuThreshold: 82, maintenanceWindow: "Sun 00:00-03:00", rebootBehavior: "manual-approval" }) } });
  const clinicPolicy = await prisma.policy.create({ data: { tenantId: tenant.id, parentId: basePolicy.id, name: "Clinical Workstation Controls", description: "Healthcare workstation requirements and reboot deferrals.", settings: JSON.stringify({ requiredSoftware: ["OpsPilot Agent", "Sentinel Endpoint", "ClinicChart"], rebootBehavior: "defer-4x" }) } });
  for (const org of organizations) await prisma.policyAssignment.create({ data: { policyId: basePolicy.id, organizationId: org.id } });
  await prisma.policyAssignment.create({ data: { policyId: clinicPolicy.id, locationId: organizations[0].locations[0].id } });

  const automationRecords = [];
  for (const [key, name, description] of automations) automationRecords.push(await prisma.automation.create({ data: { tenantId: tenant.id, key, name, description, approved: true, riskLevel: key.includes("remove") || key.includes("reboot") ? "medium" : "low" } }));

  const patchSpecs = [
    ["Microsoft", "Windows 11", "KB5061024", "2026-07 Security Rollup", "critical", true, "approved"],
    ["Microsoft", "Windows Server", "KB5060871", ".NET Runtime Security Update", "critical", true, "approved"],
    ["Apple", "macOS Sequoia", "MSU-2026-071", "macOS 15.6.1 Rapid Security Response", "high", true, "testing"],
    ["Canonical", "Ubuntu", "USN-7619-1", "OpenSSL security update", "high", false, "approved"],
    ["Google", "Chrome", "CHROME-138.0.4", "Chrome stable channel update", "moderate", false, "approved"],
    ["Adobe", "Acrobat", "APSB26-47", "Acrobat security update", "high", true, "pending"],
    ["Microsoft", "Microsoft 365", "M365-2607", "Current Channel quality update", "moderate", false, "rejected"],
    ["Red Hat", "RHEL 9", "RHSA-2026:5128", "Kernel security and stability update", "critical", true, "testing"],
  ] as const;
  const patches = [];
  for (let index = 0; index < patchSpecs.length; index++) {
    const [vendor, product, identifier, title, severity, rebootRequired, approvalState] = patchSpecs[index];
    patches.push(await prisma.patch.create({ data: { tenantId: tenant.id, vendor, product, identifier, title, severity, rebootRequired, approvalState, releaseDate: daysAgo(index + 1), cveReferences: JSON.stringify(index % 2 ? ["CVE-2026-41872"] : ["CVE-2026-40118", "CVE-2026-40129"]), deploymentRing: index < 3 ? "test" : "production" } }));
  }

  const osCatalog = [
    { os: "Windows 11 Pro", version: "24H2 (26100.4652)", role: "Workstation", maker: "Dell", model: "OptiPlex 7020", cpu: "Intel Core i7-14700", memory: 32, disk: 1024 },
    { os: "Windows Server 2025", version: "24H2 (26100.4351)", role: "Application Server", maker: "HPE", model: "ProLiant DL360 Gen11", cpu: "Intel Xeon Gold 5416S", memory: 128, disk: 4096 },
    { os: "macOS Sequoia", version: "15.6.1", role: "Creative Workstation", maker: "Apple", model: "Mac Studio M4 Max", cpu: "Apple M4 Max", memory: 64, disk: 2048 },
    { os: "Ubuntu Server", version: "24.04.2 LTS", role: "Linux Server", maker: "Lenovo", model: "ThinkSystem SR630 V3", cpu: "Intel Xeon Silver 4510", memory: 96, disk: 2048 },
  ];
  const devices = [];
  for (let index = 0; index < 30; index++) {
    const org = organizations[index % organizations.length];
    const location = org.locations[index % org.locations.length];
    const profile = osCatalog[index % osCatalog.length];
    const suffix = String(index + 1).padStart(2, "0");
    const status = index % 11 === 0 ? "critical" : index % 7 === 0 ? "offline" : index % 5 === 0 ? "warning" : "online";
    const hostname = `${org.name.split(" ").map((word) => word[0]).join("").slice(0, 3).toUpperCase()}-${profile.role.includes("Server") ? "SRV" : "WS"}-${suffix}`;
    const device = await prisma.device.create({
      data: {
        tenantId: tenant.id,
        organizationId: org.id,
        locationId: location.id,
        hostname,
        displayName: profile.role.includes("Server") ? `${location.name} ${profile.role}` : `${profile.role} ${suffix}`,
        role: profile.role,
        status,
        operatingSystem: profile.os,
        osVersion: profile.version,
        manufacturer: profile.maker,
        model: profile.model,
        serialNumber: `OPS26${String(41800 + index * 47)}`,
        cpu: profile.cpu,
        memoryGb: profile.memory,
        diskCapacityGb: profile.disk,
        diskUsedPercent: Math.round((38 + seeded(index, 2) * 57) * 10) / 10,
        ipAddress: `10.${20 + (index % 3)}.${10 + (index % 9)}.${40 + index}`,
        lastLoggedInUser: profile.role.includes("Server") ? "svc_opsmonitor" : ["a.miller", "j.garcia", "n.patel", "s.wilson"][index % 4],
        agentVersion: index % 9 === 0 ? "4.7.1" : "4.9.3",
        lastCheckIn: status === "offline" ? hoursAgo(3 + index % 5) : new Date(now.getTime() - (index + 2) * 65_000),
        uptimeMinutes: 1200 + index * 731,
        pendingReboot: index % 6 === 0,
        patchCompliance: status === "critical" ? 72 + index % 8 : 89 + index % 12,
        activeAlertCount: status === "critical" ? 2 : status === "warning" || status === "offline" ? 1 : 0,
        customFields: JSON.stringify({ assetTag: `NT-${4000 + index}`, serviceState: status === "critical" && index % 2 === 0 ? "stopped" : "running", supportTier: index % 3 === 0 ? "24x7" : "business-hours" }),
        notes: index % 8 === 0 ? "VIP or business-critical endpoint. Coordinate maintenance with site lead." : "",
        simulatorState: status === "offline" ? "stopped" : "running",
        hardwareInventory: { create: { biosVersion: `2.${3 + (index % 7)}.${index % 9}`, tpmVersion: profile.os.includes("Windows") ? "2.0" : null, cpuCores: 8 + (index % 4) * 4, macAddress: `02:42:AC:11:${suffix}:${String((index * 3) % 99).padStart(2, "0")}` } },
        softwareInventory: { create: [
          { name: "OpsPilot Agent", version: index % 9 === 0 ? "4.7.1" : "4.9.3", vendor: "Northstar Labs", required: true },
          { name: "Sentinel Endpoint", version: "8.14.2", vendor: "Sentinel", required: true },
          { name: profile.os.includes("macOS") ? "Sketchdeck" : "Microsoft 365 Apps", version: "2026.07", vendor: profile.os.includes("macOS") ? "Sketchdeck" : "Microsoft" },
          ...(index % 13 === 0 ? [{ name: "TorrentBox", version: "3.2.1", vendor: "Unknown", prohibited: true }] : []),
        ] },
        agentSessions: { create: { type: "telemetry", status: status === "offline" ? "ended" : "active", simulatorOnly: true, startedAt: daysAgo(4), endedAt: status === "offline" ? hoursAgo(3) : null } },
      },
    });
    devices.push(device);
    if (profile.role.includes("Server")) await prisma.policyAssignment.create({ data: { policyId: serverPolicy.id, deviceId: device.id } });
  }

  const metricRows = [];
  for (let day = 30; day >= 0; day--) {
    for (let index = 0; index < devices.length; index++) {
      metricRows.push({ deviceId: devices[index].id, timestamp: daysAgo(day), cpu: Math.round((18 + seeded(index + day, 1) * 68) * 10) / 10, memory: Math.round((32 + seeded(index + day, 3) * 57) * 10) / 10, disk: devices[index].diskUsedPercent, latencyMs: 18 + Math.floor(seeded(index + day, 4) * 150) });
    }
  }
  await prisma.deviceMetric.createMany({ data: metricRows });

  for (let deviceIndex = 0; deviceIndex < devices.length; deviceIndex++) {
    for (let patchIndex = 0; patchIndex < patches.length; patchIndex++) {
      const bucket = (deviceIndex + patchIndex * 3) % 11;
      const state = bucket < 6 ? "installed" : bucket < 9 ? "missing" : bucket === 9 ? "failed" : "scheduled";
      await prisma.devicePatchState.create({ data: { deviceId: devices[deviceIndex].id, patchId: patches[patchIndex].id, state, installedAt: state === "installed" ? daysAgo((deviceIndex + patchIndex) % 14) : null, lastAttemptAt: state === "failed" ? daysAgo(1) : null, failureReason: state === "failed" ? "Simulated installer returned exit code 1618 (another installation in progress)." : null } });
    }
  }

  const alerts = [];
  let ticketNumber = 1040;
  for (let index = 0; index < devices.length; index++) {
    const device = devices[index];
    if (device.status === "online") continue;
    const isCritical = device.status === "critical";
    const fingerprint = `${device.id}:${isCritical ? "service_stopped" : device.status === "offline" ? "device_offline" : "patch_compliance_low"}`;
    const alert = await prisma.alert.create({ data: { tenantId: tenant.id, organizationId: device.organizationId, deviceId: device.id, fingerprint, title: isCritical ? "Print Spooler service stopped" : device.status === "offline" ? "Agent has not checked in" : "Patch compliance below policy", description: isCritical ? "The simulated Print Spooler service is stopped and automatic recovery is available." : device.status === "offline" ? "No simulated check-in has been received within the 15-minute policy window." : `Compliance is ${device.patchCompliance}%, below the 90% policy target.`, severity: isCritical ? "critical" : "warning", priority: isCritical ? "urgent" : "normal", status: "open", triggeredAt: hoursAgo(index + 1), assigneeId: index % 2 === 0 ? tech.id : null, history: JSON.stringify([{ at: hoursAgo(index + 1).toISOString(), event: "Condition triggered", actor: "Policy engine" }]) } });
    alerts.push(alert);
    if (isCritical || index % 2 === 0) {
      const ticket = await prisma.ticket.create({ data: { tenantId: tenant.id, organizationId: device.organizationId, deviceId: device.id, alertId: alert.id, requester: "OpsPilot policy engine", assigneeId: tech.id, number: ticketNumber++, title: alert.title, description: alert.description, status: "open", priority: alert.priority, category: "Monitoring", slaTarget: new Date(now.getTime() + (isCritical ? 4 : 12) * 3_600_000) } });
      await prisma.alert.update({ where: { id: alert.id }, data: { notes: `Linked ticket #${ticket.number}` } });
    }
  }
  for (let index = 0; index < 6; index++) {
    const device = devices[(index * 4 + 2) % devices.length];
    await prisma.alert.create({ data: { tenantId: tenant.id, organizationId: device.organizationId, deviceId: device.id, fingerprint: `${device.id}:historical:${index}`, title: index % 2 ? "CPU utilization recovered" : "Required software restored", description: "A simulated policy condition cleared after approved remediation.", severity: "warning", priority: "normal", status: "resolved", triggeredAt: daysAgo(4 + index * 3), acknowledgedAt: daysAgo(4 + index * 3), resolvedAt: daysAgo(3 + index * 3), history: JSON.stringify([{ event: "Condition triggered" }, { event: "Automation completed" }, { event: "Condition cleared" }]) } });
  }

  for (let index = 0; index < 18; index++) {
    const device = devices[index % devices.length];
    const automation = automationRecords[index % automationRecords.length];
    await prisma.automationRun.create({ data: { automationId: automation.id, deviceId: device.id, requestedById: index % 3 ? tech.id : admin.id, triggerSource: index % 2 ? "on-demand" : "policy", status: index % 7 === 0 ? "failed" : "succeeded", input: "{}", output: index % 7 === 0 ? "" : "Simulated executor completed the approved action successfully.", failureReason: index % 7 === 0 ? "Endpoint did not check in before the simulated timeout." : null, startedAt: hoursAgo(index * 7 + 1), completedAt: hoursAgo(index * 7), createdAt: hoursAgo(index * 7 + 1) } });
  }

  const reportTypes = ["Device inventory", "Software inventory", "Patch compliance", "Missing critical patches", "Alert activity", "Automation activity", "Ticket performance", "Technician activity", "Device availability", "Audit history"];
  for (const name of reportTypes) await prisma.reportDefinition.create({ data: { tenantId: tenant.id, name, type: name.toLowerCase().replaceAll(" ", "-") } });

  const auditActions = ["user.login", "policy.updated", "automation.executed", "patch.approved", "alert.acknowledged", "ticket.updated", "device.enrolled"];
  for (let index = 0; index < 42; index++) {
    const device = devices[index % devices.length];
    await prisma.auditEvent.create({ data: { tenantId: tenant.id, organizationId: device.organizationId, actorId: index % 5 === 0 ? admin.id : tech.id, action: auditActions[index % auditActions.length], resourceType: index % 3 === 0 ? "Device" : index % 3 === 1 ? "Policy" : "Alert", resourceId: index % 3 === 0 ? device.id : `seed-${index}`, success: index % 17 !== 0, requestContext: "seeded local demonstration", beforeSummary: index % 2 ? null : JSON.stringify({ status: "pending" }), afterSummary: JSON.stringify({ status: index % 17 === 0 ? "failed" : "completed" }), createdAt: hoursAgo(index * 15) } });
  }
  await prisma.notification.createMany({ data: alerts.slice(0, 6).map((alert) => ({ tenantId: tenant.id, userId: admin.id, type: "alert", title: alert.title, body: `A ${alert.severity} simulated condition requires review.` })) });

  console.log(`Seeded OpsPilot RMM: ${organizations.length} organizations, ${devices.length} devices, ${patches.length} patches, ${alerts.length + 6} alerts.`);
}

main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => prisma.$disconnect());
