import { defineConfig, devices } from "@playwright/test";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const e2ePort = Number(process.env.E2E_PORT ?? "3100");
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? "file:./opspilot.e2e.db";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: e2eBaseUrl, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `npm run db:e2e:reset && npm run setup && npm run dev -- --port ${e2ePort}`,
    url: `${e2eBaseUrl}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl, APP_URL: e2eBaseUrl, AGENT_SERVER_URL: e2eBaseUrl },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
