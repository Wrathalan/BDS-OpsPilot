import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const temporaryAgentDirectories = new Set<string>();
test.afterEach(async () => { await Promise.all([...temporaryAgentDirectories].map((directory) => rm(directory, { recursive: true, force: true }))); temporaryAgentDirectories.clear(); });

test("root enrolls a live agent and completes an allowlisted task", async ({ page }) => {
  const rootPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!rootPassword) throw new Error("BOOTSTRAP_ADMIN_PASSWORD is required for the live workflow test.");

  const suffix = Date.now().toString().slice(-6);
  const orgName = `Live Test ${suffix}`;
  const locationName = `Agent Lab ${suffix}`;
  const hostname = os.hostname().toUpperCase();

  await page.goto("/login");
  await page.getByLabel("Username or email").fill("root");
  await page.getByLabel("Password", { exact: true }).fill(rootPassword);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();

  await page.getByRole("link", { name: "Organizations" }).click();
  await page.getByRole("button", { name: "Add organization" }).click();
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByLabel("URL slug").fill(`live-test-${suffix}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  const orgCard = page.locator("article").filter({ hasText: orgName });
  await expect(orgCard).toBeVisible();
  await orgCard.getByRole("button", { name: "Add site" }).click();
  await page.getByLabel("Location name").fill(locationName);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(orgCard.getByText(locationName)).toBeVisible();

  await page.getByRole("link", { name: "Devices" }).click();
  await page.getByRole("button", { name: "Enroll endpoint" }).click();
  await page.getByLabel("Organization").selectOption({ label: orgName });
  await page.getByLabel("Location").selectOption({ label: locationName });
  await page.getByLabel("Token name").fill(`Enrollment ${suffix}`);
  await page.getByRole("button", { name: "Issue token" }).click();
  const enrollmentToken = await page.locator(".live-token-result code").innerText();
  expect(enrollmentToken).toMatch(/^ops_enroll_/);

  const agentDataDir = await mkdtemp(path.join(os.tmpdir(), "opspilot-agent-e2e-"));
  temporaryAgentDirectories.add(agentDataDir);
  const agentScript = path.join(process.cwd(), "agent", "opspilot-agent.mjs");
  const enrolled = await execFileAsync(process.execPath, [agentScript, "enroll", "--server", "http://127.0.0.1:3000", "--token", enrollmentToken, "--data-dir", agentDataDir]);
  expect(enrolled.stdout).toContain("Enrolled");
  const firstCheckIn = await execFileAsync(process.execPath, [agentScript, "once", "--data-dir", agentDataDir]);
  expect(firstCheckIn.stdout).toContain("Check-in accepted");

  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  const endpointLink = page.getByRole("link", { name: new RegExp(hostname, "i") }).first();
  await expect(endpointLink).toBeVisible();
  await endpointLink.click();
  await page.getByRole("button", { name: "Automation" }).click();
  const refreshRow = page.locator(".device-automation-list > div").filter({ hasText: "Refresh Agent Status" });
  await refreshRow.getByRole("button", { name: "Queue" }).click();
  await expect(page.getByText(/queued for agent pickup/i)).toBeVisible();

  const taskCycle = await execFileAsync(process.execPath, [agentScript, "once", "--data-dir", agentDataDir]);
  expect(taskCycle.stdout.match(/Check-in accepted/g)?.length).toBeGreaterThanOrEqual(2);

  await page.getByRole("link", { name: "Audit Log" }).click();
  await page.getByPlaceholder("Search actor, action, resource…").fill("agent.automation_completed");
  await expect(page.getByText("agent.automation_completed").first()).toBeVisible();
});
