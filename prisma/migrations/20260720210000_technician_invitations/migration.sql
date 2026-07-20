CREATE TABLE "TechnicianInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "allOrganizations" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "acceptedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TechnicianInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TechnicianInvite_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TechnicianInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "TechnicianInviteOrganization" (
    "inviteId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    PRIMARY KEY ("inviteId", "organizationId"),
    CONSTRAINT "TechnicianInviteOrganization_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "TechnicianInvite" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TechnicianInviteOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TechnicianInvite_tokenHash_key" ON "TechnicianInvite"("tokenHash");
CREATE INDEX "TechnicianInvite_tenantId_email_expiresAt_idx" ON "TechnicianInvite"("tenantId", "email", "expiresAt");
CREATE INDEX "TechnicianInvite_createdById_createdAt_idx" ON "TechnicianInvite"("createdById", "createdAt");
CREATE INDEX "TechnicianInviteOrganization_organizationId_idx" ON "TechnicianInviteOrganization"("organizationId");
