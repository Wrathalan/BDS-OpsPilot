import { PrismaClient } from "@prisma/client";
import { compare, hash } from "bcryptjs";

const prisma = new PrismaClient();

const permissions = [
  ["tenant.manage", "Manage tenant security and settings"],
  ["organization.manage", "Create and update organizations and locations"],
  ["device.view", "View device inventory and telemetry"],
  ["device.manage", "Enroll devices and update device state"],
  ["remote.control", "Start audited remote desktop support sessions"],
  ["alert.manage", "Acknowledge, assign, suppress, and resolve alerts"],
  ["automation.run", "Queue approved agent actions"],
  ["patch.manage", "Approve and coordinate patch deployment"],
  ["ticket.manage", "Manage service desk tickets"],
  ["report.view", "View and export reports"],
  ["audit.view", "View audit history"],
];

const roleSpecs = [
  { name: "Admin", key: "admin", description: "Full control-plane administration", permissions: permissions.map(([key]) => key) },
  { name: "Technician", key: "technician", description: "Scoped operations and approved actions", permissions: ["device.view", "device.manage", "remote.control", "alert.manage", "automation.run", "patch.manage", "ticket.manage", "report.view", "audit.view"] },
  { name: "Read-Only Auditor", key: "auditor", description: "Read-only compliance access", permissions: ["device.view", "report.view", "audit.view"] },
];

async function main() {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME || "root";
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const legacyPasswordAllowed = process.env.ALLOW_KNOWN_ADMIN_PASSWORD === "1" && password === "Ethic0n1";
  if (!password || (!legacyPasswordAllowed && (password.length < 12 || ["Ethic0n1", "change-this-before-starting"].includes(password)))) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be a unique value containing at least 12 characters unless the explicit legacy recovery exception is enabled.");
  }

  const tenant = await prisma.tenant.upsert({
    where: { slug: process.env.TENANT_SLUG || "opspilot-local" },
    update: { name: process.env.TENANT_NAME || "OpsPilot Live" },
    create: { slug: process.env.TENANT_SLUG || "opspilot-local", name: process.env.TENANT_NAME || "OpsPilot Live" },
  });

  const permissionIds = new Map();
  for (const [key, description] of permissions) {
    const permission = await prisma.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
    permissionIds.set(key, permission.id);
  }

  const roles = new Map();
  for (const spec of roleSpecs) {
    const role = await prisma.role.upsert({
      where: { tenantId_systemKey: { tenantId: tenant.id, systemKey: spec.key } },
      update: { name: spec.name, description: spec.description },
      create: { tenantId: tenant.id, name: spec.name, description: spec.description, systemKey: spec.key },
    });
    for (const key of spec.permissions) {
      const permissionId = permissionIds.get(key);
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId } }, update: {}, create: { roleId: role.id, permissionId } });
    }
    roles.set(spec.key, role.id);
  }

  const existingAdmin = await prisma.user.findUnique({ where: { tenantId_username: { tenantId: tenant.id, username } } });
  const passwordChanged = Boolean(existingAdmin && !(await compare(password, existingAdmin.passwordHash)));
  const passwordHash = await hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username } },
    update: { email: process.env.BOOTSTRAP_ADMIN_EMAIL || "root@localhost", name: process.env.BOOTSTRAP_ADMIN_NAME || "root", passwordHash, roleId: roles.get("admin"), active: true, allOrganizations: true },
    create: { tenantId: tenant.id, username, email: process.env.BOOTSTRAP_ADMIN_EMAIL || "root@localhost", name: process.env.BOOTSTRAP_ADMIN_NAME || "root", passwordHash, roleId: roles.get("admin"), active: true, allOrganizations: true },
  });
  if (passwordChanged) await prisma.session.deleteMany({ where: { userId: admin.id } });

  const actionDefinitions = [
    { key: "refresh-agent", name: "Refresh agent status", description: "Requests an immediate authenticated check-in from the endpoint agent." },
    { key: "inventory-refresh", name: "Perform inventory refresh", description: "Requests fresh hardware and software inventory from the endpoint agent." },
  ];
  for (const definition of actionDefinitions) {
    await prisma.automation.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: definition.key } },
      update: { ...definition, approved: true, riskLevel: "low" },
      create: { tenantId: tenant.id, ...definition, approved: true, riskLevel: "low" },
    });
  }

  const baseline = await prisma.policy.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "Live Endpoint Baseline" } },
    update: {},
    create: {
      tenantId: tenant.id,
      name: "Live Endpoint Baseline",
      description: "Default live telemetry thresholds. Assign this policy after creating an organization.",
      settings: JSON.stringify({ cpuThreshold: 90, memoryThreshold: 90, diskFreeThreshold: 10, offlineMinutes: 15, maintenanceWindow: "Unassigned", rebootBehavior: "manual-approval", requiredSoftware: [], prohibitedSoftware: [], notifications: ["in-app"] }),
      conditions: { create: [
        { type: "cpu_high", comparator: ">", threshold: 90, durationMinutes: 10, severity: "warning" },
        { type: "memory_high", comparator: ">", threshold: 90, durationMinutes: 10, severity: "warning" },
        { type: "disk_low", comparator: "<", threshold: 10, durationMinutes: 5, severity: "critical", createTicket: true },
        { type: "device_offline", comparator: ">", threshold: 15, durationMinutes: 15, severity: "warning" },
      ] },
    },
  });

  const reportTypes = ["Device inventory", "Software inventory", "Patch compliance", "Alert activity", "Automation activity", "Ticket performance", "Device availability", "Audit history"];
  for (const name of reportTypes) {
    await prisma.reportDefinition.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name, type: name.toLowerCase().replaceAll(" ", "-") },
    });
  }

  const existingBootstrap = await prisma.auditEvent.findFirst({ where: { tenantId: tenant.id, action: "system.bootstrap", resourceId: tenant.id } });
  if (!existingBootstrap) await prisma.auditEvent.create({ data: { tenantId: tenant.id, actorId: admin.id, action: "system.bootstrap", resourceType: "Tenant", resourceId: tenant.id, requestContext: "local-bootstrap", afterSummary: JSON.stringify({ username, mode: "live", baselinePolicyId: baseline.id }) } });

  console.log(`OpsPilot live bootstrap complete for tenant "${tenant.name}" and administrator "${username}".`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); }).finally(async () => prisma.$disconnect());
