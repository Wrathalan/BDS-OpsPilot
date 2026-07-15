CREATE TABLE "RemoteEndpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "serverUrl" TEXT NOT NULL,
    "encryptedSecret" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "installedAt" DATETIME,
    "lastVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RemoteEndpoint_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RemoteEndpoint_deviceId_provider_key" ON "RemoteEndpoint"("deviceId", "provider");
CREATE INDEX "RemoteEndpoint_provider_externalId_idx" ON "RemoteEndpoint"("provider", "externalId");
CREATE INDEX "RemoteEndpoint_status_lastVerifiedAt_idx" ON "RemoteEndpoint"("status", "lastVerifiedAt");
