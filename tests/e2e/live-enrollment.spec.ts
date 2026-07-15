import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  await page.getByRole("link", { name: "Devices" }).click();
  await page.getByRole("button", { name: "Enroll endpoint" }).click();
  const quickCreate = page.getByRole("button", { name: /Create organization/ });
  if (await quickCreate.isVisible()) {
    await expect(page.getByRole("button", { name: /Add location/ })).toBeDisabled();
    await quickCreate.click();
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("URL slug").fill(`live-test-${suffix}`);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(page.getByText("Organization created.")).toBeVisible();

    await page.getByRole("button", { name: "Enroll endpoint" }).click();
    await page.getByRole("button", { name: /Add location/ }).click();
    await page.getByLabel("Organization").selectOption({ label: orgName });
    await page.getByLabel("Location name").fill(locationName);
    await page.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByText("Location created.")).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("link", { name: "Organizations" }).click();
    await page.getByRole("button", { name: "Add organization" }).click();
    await page.getByLabel("Organization name").fill(orgName);
    await page.getByLabel("URL slug").fill(`live-test-${suffix}`);
    await page.getByRole("button", { name: "Create organization" }).click();
    const orgRow = page.getByRole("row", { name: new RegExp(orgName, "i") });
    await expect(orgRow).toBeVisible();
    await orgRow.getByRole("button", { name: "Add site" }).click();
    await page.getByLabel("Location name").fill(locationName);
    await page.getByRole("button", { name: "Add location" }).click();
    await page.getByRole("link", { name: "Devices" }).click();
  }

  await page.getByRole("button", { name: "Enroll endpoint" }).click();
  await page.getByLabel("Organization").selectOption({ label: orgName });
  await page.getByLabel("Location").selectOption({ label: locationName });
  await page.getByLabel("Package name").fill(`Enrollment ${suffix}`);
  const tokenResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/actions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create agent package" }).click();
  const enrollmentToken = (await tokenResponsePromise).json().then((result) => result.token as string);
  await expect(page.getByRole("button", { name: "Download .exe" })).toBeVisible();
  expect(await enrollmentToken).toMatch(/^ops_enroll_/);

  const agentDataDir = await mkdtemp(path.join(os.tmpdir(), "opspilot-agent-e2e-"));
  temporaryAgentDirectories.add(agentDataDir);
  const personalizedAgent = path.join(agentDataDir, "opspilot-agent-windows-x64.exe");
  const agentDownload = await page.request.post("/api/agent/windows/download", { data: { token: await enrollmentToken } });
  expect(agentDownload.ok()).toBe(true);
  expect(agentDownload.headers()["content-type"]).toBe("application/vnd.microsoft.portable-executable");
  expect(agentDownload.headers()["x-opspilot-server"]).toMatch(/^https?:\/\//);
  expect(agentDownload.headers()["x-opspilot-sha256"]).toMatch(/^[a-f0-9]{64}$/);
  const personalizedBytes = await agentDownload.body();
  expect(personalizedBytes.length).toBeGreaterThan(50_000_000);
  expect(personalizedBytes.subarray(-"OPSPILOT_ENROLLMENT_V1".length).toString("ascii")).toBe("OPSPILOT_ENROLLMENT_V1");
  await writeFile(personalizedAgent, personalizedBytes);

  const agentScript = path.join(process.cwd(), "agent", "opspilot-agent.mjs");
  const useWindowsExecutable = process.platform === "win32";
  const runAgent = (agentArgs: string[]) => execFileAsync(useWindowsExecutable ? personalizedAgent : process.execPath, useWindowsExecutable ? agentArgs : [agentScript, ...agentArgs]);
  const enrolled = useWindowsExecutable
    ? await execFileAsync(personalizedAgent, [], { env: { ...process.env, OPSPILOT_DATA_DIR: agentDataDir, OPSPILOT_EXIT_AFTER_ENROLL: "1" } })
    : await runAgent(["enroll", "--server", "http://127.0.0.1:3000", "--token", await enrollmentToken, "--data-dir", agentDataDir]);
  expect(enrolled.stdout).toContain("Enrolled");
  if (useWindowsExecutable) expect(enrolled.stdout).toContain("Personalized enrollment package detected");
  const firstCheckIn = await runAgent(["once", "--data-dir", agentDataDir]);
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

  const taskCycle = await runAgent(["once", "--data-dir", agentDataDir]);
  expect(taskCycle.stdout).toContain("Check-in accepted");
  if (useWindowsExecutable) expect(taskCycle.stdout).toContain("Completed allowlisted task");

  await page.getByRole("link", { name: "Audit Log" }).click();
  await page.getByPlaceholder("Search actor, action, resource…").fill("agent.automation_completed");
  await expect(page.getByText("agent.automation_completed").first()).toBeVisible();
});
