-- CreateTable
CREATE TABLE "EnrollmentToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnrollmentToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnrollmentToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnrollmentToken_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EnrollmentToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'telemetry',
    "status" TEXT NOT NULL DEFAULT 'active',
    "requestedBy" TEXT,
    "approvedBy" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "AgentSession_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AgentSession" ("approvedBy", "deviceId", "endedAt", "id", "requestedBy", "startedAt", "status", "type") SELECT "approvedBy", "deviceId", "endedAt", "id", "requestedBy", "startedAt", "status", "type" FROM "AgentSession";
DROP TABLE "AgentSession";
ALTER TABLE "new_AgentSession" RENAME TO "AgentSession";
CREATE INDEX "AgentSession_deviceId_startedAt_idx" ON "AgentSession"("deviceId", "startedAt");
CREATE TABLE "new_Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'online',
    "operatingSystem" TEXT NOT NULL,
    "osVersion" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL,
    "cpu" TEXT NOT NULL,
    "memoryGb" INTEGER NOT NULL,
    "diskCapacityGb" INTEGER NOT NULL,
    "diskUsedPercent" REAL NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "lastLoggedInUser" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "lastCheckIn" DATETIME NOT NULL,
    "uptimeMinutes" INTEGER NOT NULL,
    "pendingReboot" BOOLEAN NOT NULL DEFAULT false,
    "patchCompliance" REAL NOT NULL DEFAULT 100,
    "activeAlertCount" INTEGER NOT NULL DEFAULT 0,
    "customFields" TEXT NOT NULL DEFAULT '{}',
    "notes" TEXT NOT NULL DEFAULT '',
    "managementMode" TEXT NOT NULL DEFAULT 'agent',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Device_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Device_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Device_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("activeAlertCount", "agentVersion", "cpu", "createdAt", "customFields", "diskCapacityGb", "diskUsedPercent", "displayName", "hostname", "id", "ipAddress", "lastCheckIn", "lastLoggedInUser", "locationId", "manufacturer", "memoryGb", "model", "notes", "operatingSystem", "organizationId", "osVersion", "patchCompliance", "pendingReboot", "role", "serialNumber", "status", "tenantId", "updatedAt", "uptimeMinutes") SELECT "activeAlertCount", "agentVersion", "cpu", "createdAt", "customFields", "diskCapacityGb", "diskUsedPercent", "displayName", "hostname", "id", "ipAddress", "lastCheckIn", "lastLoggedInUser", "locationId", "manufacturer", "memoryGb", "model", "notes", "operatingSystem", "organizationId", "osVersion", "patchCompliance", "pendingReboot", "role", "serialNumber", "status", "tenantId", "updatedAt", "uptimeMinutes" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE INDEX "Device_tenantId_organizationId_status_idx" ON "Device"("tenantId", "organizationId", "status");
CREATE INDEX "Device_locationId_idx" ON "Device"("locationId");
CREATE UNIQUE INDEX "Device_tenantId_hostname_key" ON "Device"("tenantId", "hostname");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allOrganizations" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "allOrganizations", "createdAt", "email", "username", "id", "lastLoginAt", "name", "passwordHash", "roleId", "tenantId") SELECT "active", "allOrganizations", "createdAt", "email", "email", "id", "lastLoginAt", "name", "passwordHash", "roleId", "tenantId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE INDEX "User_tenantId_active_idx" ON "User"("tenantId", "active");
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");
CREATE UNIQUE INDEX "User_tenantId_username_key" ON "User"("tenantId", "username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EnrollmentToken_tokenHash_key" ON "EnrollmentToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EnrollmentToken_tenantId_expiresAt_idx" ON "EnrollmentToken"("tenantId", "expiresAt");

-- CreateIndex
CREATE INDEX "EnrollmentToken_organizationId_locationId_idx" ON "EnrollmentToken"("organizationId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_secretHash_key" ON "AgentCredential"("secretHash");

-- CreateIndex
CREATE INDEX "AgentCredential_deviceId_revokedAt_idx" ON "AgentCredential"("deviceId", "revokedAt");
