import { rm } from "node:fs/promises";
import path from "node:path";

const database = path.join(process.cwd(), "prisma", "opspilot.e2e.db");

await Promise.all([
  rm(database, { force: true }),
  rm(`${database}-journal`, { force: true }),
  rm(`${database}-shm`, { force: true }),
  rm(`${database}-wal`, { force: true }),
]);

console.log("Prepared isolated OpsPilot E2E database.");
