import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL && existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("file:")) process.exit(0);

const schemaDirectory = path.dirname(fileURLToPath(import.meta.url));
const configuredPath = databaseUrl.slice("file:".length).split("?", 1)[0];
const databasePath = path.isAbsolute(configuredPath) ? configuredPath : path.resolve(schemaDirectory, configuredPath);

mkdirSync(path.dirname(databasePath), { recursive: true });
if (!existsSync(databasePath)) closeSync(openSync(databasePath, "a", 0o600));
console.log(`SQLite database path ready: ${databasePath}`);
