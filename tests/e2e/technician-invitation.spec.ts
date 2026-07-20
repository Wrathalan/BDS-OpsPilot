import { expect, test } from "@playwright/test";

test("administrator invites a scoped technician who creates their own account", async ({ page, browser }) => {
  const rootPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!rootPassword) throw new Error("BOOTSTRAP_ADMIN_PASSWORD is required for the invitation workflow test.");
  const suffix = Date.now().toString().slice(-7);
  const email = `tech-${suffix}@example.test`;
  const username = `tech-${suffix}`;
  const name = `Pilot Technician ${suffix}`;

  await page.goto("/login");
  await page.getByLabel("Username or email").fill("root");
  await page.getByLabel("Password", { exact: true }).fill(rootPassword);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await page.getByRole("link", { name: "Administration" }).click();
  await page.getByRole("button", { name: "Invite technician" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Invitation ready")).toBeVisible();
  const invitationUrl = await page.locator(".live-token-result code").textContent();
  expect(invitationUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/invite\/ops_invite_/);

  const technicianContext = await browser.newContext();
  const technicianPage = await technicianContext.newPage();
  await technicianPage.goto(invitationUrl!);
  await expect(technicianPage.getByRole("heading", { name: "Set up your account" })).toBeVisible();
  await expect(technicianPage.getByLabel("Email")).toHaveValue(email);
  await technicianPage.getByLabel("Username").fill(username);
  await technicianPage.getByLabel("Password", { exact: true }).fill("Pilot-Tech-Access1!");
  await technicianPage.getByLabel("Confirm password").fill("Pilot-Tech-Access1!");
  await technicianPage.getByRole("button", { name: "Create technician account" }).click();
  await expect(technicianPage.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await expect(technicianPage.getByRole("button", { name: new RegExp(`${name}.*Technician`) })).toBeVisible();
  await technicianContext.close();

  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  const inviteRow = page.getByRole("row", { name: new RegExp(email) });
  await expect(inviteRow).toBeVisible();
  await expect(inviteRow.getByText("accepted", { exact: true })).toBeVisible();
  await expect(page.locator(".user-list").getByText(name, { exact: true })).toBeVisible();
});
