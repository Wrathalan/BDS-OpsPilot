import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

function reportFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`OpsPilot backup failed: ${message}`);
  process.exit(1);
}
process.on("uncaughtException", reportFailure);
process.on("unhandledRejection", reportFailure);

const backupRoot = process.env.OPSPILOT_BACKUP_DIR || "/backups";
const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10);
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
  throw new Error("BACKUP_RETENTION_DAYS must be between 1 and 3650.");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("file:")) throw new Error("Only the configured SQLite database can be backed up by this command.");
const configuredDatabasePath = databaseUrl.slice("file:".length).split("?", 1)[0];
const databasePath = path.isAbsolute(configuredDatabasePath) ? configuredDatabasePath : path.resolve("prisma", configuredDatabasePath);
if (!existsSync(databasePath)) throw new Error(`Database not found at ${databasePath}.`);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDirectory = path.join(backupRoot, timestamp);
const backupDatabase = path.join(backupDirectory, "opspilot.db");
const snapshotDatabase = path.join(path.dirname(databasePath), `.opspilot-backup-${timestamp}.db`);
mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });

const prisma = new PrismaClient();
try {
  const escapedPath = snapshotDatabase.replaceAll("'", "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedPath}'`);
} catch (error) {
  rmSync(snapshotDatabase, { force: true });
  rmSync(backupDirectory, { recursive: true, force: true });
  throw error;
} finally {
  await prisma.$disconnect();
}
try {
  copyFileSync(snapshotDatabase, backupDatabase);
  chmodSync(backupDatabase, 0o600);
} catch (error) {
  rmSync(backupDirectory, { recursive: true, force: true });
  throw error;
} finally {
  rmSync(snapshotDatabase, { force: true });
}

const files = [backupDatabase];
for (const fileName of ["id_ed25519", "id_ed25519.pub"]) {
  const source = path.join("/rustdesk", fileName);
  if (!existsSync(source)) continue;
  const destination = path.join(backupDirectory, fileName);
  copyFileSync(source, destination);
  chmodSync(destination, 0o600);
  files.push(destination);
}

const manifest = {
  createdAt: new Date().toISOString(),
  format: 1,
  files: files.map((file) => ({
    name: path.basename(file),
    bytes: statSync(file).size,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  })),
};
writeFileSync(path.join(backupDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

const cutoff = Date.now() - retentionDays * 86_400_000;
for (const entry of readdirSync(backupRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === timestamp || !/^\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
  const candidate = path.join(backupRoot, entry.name);
  if (statSync(candidate).mtimeMs < cutoff) rmSync(candidate, { recursive: true, force: true });
}

console.log(`Verified backup created: ${backupDirectory}`);
