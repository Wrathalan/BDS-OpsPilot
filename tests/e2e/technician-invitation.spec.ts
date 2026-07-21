import { expect, test } from "@playwright/test";

test("administrator invites and manages another administrator account", async ({ page, browser }) => {
  const rootPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!rootPassword) throw new Error("BOOTSTRAP_ADMIN_PASSWORD is required for the invitation workflow test.");
  const suffix = Date.now().toString().slice(-7);
  const email = `admin-${suffix}@example.test`;
  const username = `admin-${suffix}`;
  const name = `Pilot Admin ${suffix}`;

  await page.goto("/login");
  await page.getByLabel("Username or email").fill("root");
  await page.getByLabel("Password", { exact: true }).fill(rootPassword);
  await page.getByRole("button", { name: "Sign in to console" }).click();
  await expect(page.getByRole("button", { name: /root.*Admin/i })).toBeVisible();
  await page.getByRole("link", { name: "Administration" }).click();
  await page.getByRole("button", { name: "Invite operator" }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email address").fill(email);
  const inviteScope = page.getByLabel("All current and future organizations");
  await inviteScope.uncheck();
  await page.getByLabel("Role").selectOption("admin");
  await expect(inviteScope).toBeChecked();
  await page.getByRole("button", { name: "Create invitation" }).click();
  await expect(page.getByText("Invitation ready")).toBeVisible();
  const invitationUrl = await page.locator(".live-token-result code").textContent();
  expect(invitationUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/invite\/ops_invite_/);

  const operatorContext = await browser.newContext();
  const operatorPage = await operatorContext.newPage();
  await operatorPage.goto(invitationUrl!);
  await expect(operatorPage.getByRole("heading", { name: "Set up your account" })).toBeVisible();
  await expect(operatorPage.getByText("Admin", { exact: true })).toBeVisible();
  await expect(operatorPage.getByLabel("Email")).toHaveValue(email);
  await operatorPage.getByLabel("Username").fill(username);
  await operatorPage.getByLabel("Password", { exact: true }).fill("Pilot-Admin-Access1!");
  await operatorPage.getByLabel("Confirm password").fill("Pilot-Admin-Access1!");
  await operatorPage.getByRole("button", { name: "Create operator account" }).click();
  await expect(operatorPage.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await expect(operatorPage.getByRole("button", { name: new RegExp(`${name}.*Admin`) })).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await page.reload();
  const inviteRow = page.getByRole("row", { name: new RegExp(email) });
  await expect(inviteRow).toBeVisible();
  await expect(inviteRow.getByText("accepted", { exact: true })).toBeVisible();
  const userList = page.locator(".user-list");
  await expect(userList.getByText(name, { exact: true })).toBeVisible();
  await expect(userList.getByRole("button", { name: "Edit root" })).toHaveCount(0);

  await userList.getByRole("button", { name: `Edit ${name}` }).click();
  const editDialog = page.getByRole("dialog", { name: `Edit ${name}` });
  await editDialog.getByLabel("Role").selectOption("auditor");
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Operator account updated.")).toBeVisible();
  await expect(userList.getByText(/Read-Only Auditor/)).toBeVisible();

  await userList.getByRole("button", { name: `Edit ${name}` }).click();
  const promotionDialog = page.getByRole("dialog", { name: `Edit ${name}` });
  await promotionDialog.getByLabel("All current and future organizations").uncheck();
  await promotionDialog.getByLabel("Role").selectOption("admin");
  await expect(promotionDialog.getByLabel("All current and future organizations")).toBeChecked();
  await promotionDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(userList.locator(":scope > div").filter({ hasText: name })).toContainText("Admin");

  await userList.getByRole("button", { name: `Delete ${name}` }).click();
  const deleteDialog = page.getByRole("dialog", { name: `Delete ${name}` });
  await deleteDialog.getByRole("button", { name: "Delete operator" }).click();
  await expect(page.getByText("Operator account deleted.")).toBeVisible();
  await expect(userList.getByText(name, { exact: true })).toHaveCount(0);
  await operatorPage.goto("/overview");
  await expect(operatorPage.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await operatorContext.close();
});
