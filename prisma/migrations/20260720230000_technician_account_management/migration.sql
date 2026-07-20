ALTER TABLE "User" ADD COLUMN "deletedAt" DATETIME;

CREATE INDEX "User_tenantId_deletedAt_idx" ON "User"("tenantId", "deletedAt");
