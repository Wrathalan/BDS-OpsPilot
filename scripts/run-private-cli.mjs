import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const [tool, ...args] = process.argv.slice(2);
const entrypoints = {
  next: path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"),
  prisma: path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
};
const entrypoint = entrypoints[tool];
if (!entrypoint || !existsSync(entrypoint)) {
  console.error(`Unsupported or unavailable private CLI: ${tool || "(missing)"}`);
  process.exit(1);
}

const environment = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  CHECKPOINT_DISABLE: "1",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_UPDATE_NOTIFIER: "false",
  NO_UPDATE_NOTIFIER: "1",
};
const result = spawnSync(process.execPath, [entrypoint, ...args], { cwd: process.cwd(), env: environment, stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
