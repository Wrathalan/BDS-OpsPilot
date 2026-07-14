import { expect, test } from "@playwright/test";

test("administrator creates a scope, enrolls a simulator, and remediates an alert", async ({ page }) => {
  const suffix = Date.now().toString().slice(-6);
  const orgName = `E2E Operations ${suffix}`;
  const slug = `e2e-operations-${suffix}`;
  const locationName = `E2E Site ${suffix}`;
  const hostname = `E2E-WS-${suffix}`;

  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@opspilot.local");
  await page.getByLabel("Password", { exact: true }).fill("OpsPilot!2026");
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();

  await page.getByRole("link", { name: "Organizations" }).click();
  await page.getByRole("button", { name: "Add organization" }).click();
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByLabel("URL slug").fill(slug);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByText(orgName)).toBeVisible();
  const orgCard = page.locator("article").filter({ hasText: orgName });
  await orgCard.getByRole("button", { name: "Add site" }).click();
  await page.getByLabel("Location name").fill(locationName);
  await page.getByRole("button", { name: "Add location" }).click();
  await expect(page.getByText(locationName)).toBeVisible();

  await page.getByRole("link", { name: "Administration" }).click();
  await page.getByRole("button", { name: "Create policy" }).click();
  await page.getByLabel("Policy name").fill(`E2E Baseline ${suffix}`);
  await page.getByLabel("Description").fill("End-to-end service recovery policy.");
  await page.getByLabel("Assign organization").selectOption({ label: orgName });
  await page.getByRole("button", { name: "Create policy" }).last().click();

  await page.getByRole("link", { name: "Devices" }).click();
  await page.getByRole("button", { name: "Generate endpoint" }).click();
  await page.getByLabel("Organization").selectOption({ label: orgName });
  await page.getByLabel("Location").selectOption({ label: locationName });
  await page.getByLabel("Hostname").fill(hostname);
  await page.getByLabel("Display name").fill(`E2E Workstation ${suffix}`);
  await page.getByRole("button", { name: "Generate endpoint" }).last().click();
  await expect(page.getByText(hostname)).toBeVisible();
  await page.getByText(hostname).click();

  await page.getByRole("button", { name: "Monitoring" }).click();
  await page.getByRole("button", { name: "Stopped service" }).click();
  await expect(page.getByText(/condition triggered/i)).toBeVisible();

  await page.getByRole("link", { name: "Alerts" }).click();
  const alertRow = page.locator("tr").filter({ hasText: hostname }).filter({ hasText: "Print Spooler service stopped" });
  await expect(alertRow).toBeVisible();
  await alertRow.getByRole("button", { name: "Run fix" }).click();
  await expect(page.getByText("Service recovered and alert resolved.")).toBeVisible();
  await expect(alertRow.getByText(/Resolved/)).toBeVisible();

  await page.getByRole("link", { name: "Audit Log" }).click();
  await page.getByPlaceholder("Search actor, action, resource…").fill("automation.executed");
  await expect(page.getByText("automation.executed").first()).toBeVisible();
});
