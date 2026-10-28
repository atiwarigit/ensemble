import { expect, test } from "@playwright/test";
import { NIKKI, PASSWORD, signIn, signInAsOwner, signOut } from "./helpers";

test.describe.configure({ mode: "serial" });

let xaniaUrl = "";

test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fprojects/);
});

test("public sign-up is disabled", async ({ request }) => {
  const res = await request.post("/api/auth/sign-up/email", {
    data: { email: "stranger@example.com", password: "a-long-password-123", name: "Stranger" },
  });
  expect(res.ok()).toBeFalsy();
});

test("owner must enrol 2FA, then creates a private project", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Xania");
  await page.getByLabel("Artist name").fill("Xania");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  xaniaUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: "Xania" })).toBeVisible();
  await expect(page.getByTestId("project-member")).toHaveCount(1);
});

test("owner invites a new member who accepts the invite", async ({ page, browser }) => {
  await signInAsOwner(page);
  await page.goto("/settings/members");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByRole("button", { name: "Create invite" }).click();
  const url = (await page.getByTestId("invite-url").textContent())!.trim();
  expect(url).toContain("/invite/");

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(new URL(url).pathname);
  await guestPage.getByLabel("Your name").fill("Sam");
  await guestPage.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await guestPage.getByLabel("Confirm password").fill(PASSWORD);
  await guestPage.getByRole("button", { name: "Create account" }).click();
  await expect(guestPage.getByRole("heading", { name: /Welcome back, Sam/ })).toBeVisible();
  await expect(guestPage.getByText("You aren't on any projects yet.")).toBeVisible();

  // The link is single-use.
  await guestPage.goto(new URL(url).pathname);
  await expect(guestPage.getByText("Invite unavailable")).toBeVisible();
  await guest.close();
});

test("a member can't see a project they aren't on", async ({ page }) => {
  await signIn(page, NIKKI);
  await expect(page.getByRole("heading", { name: /Welcome back, Nikki/ })).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByRole("link", { name: "Xania" })).toHaveCount(0);
  const res = await page.goto(xaniaUrl);
  expect(res?.status()).toBe(404);
  await page.goto("/audit");
  await expect(page.getByText("project.created")).toHaveCount(0);
});

test("after being added, the member can see the project", async ({ page, browser }) => {
  await signInAsOwner(page);
  await page.goto(xaniaUrl);
  await page.getByLabel("Person to add").click();
  await page.getByRole("option", { name: /Nikki/ }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("project-member")).toHaveCount(2);

  const nikki = await browser.newContext();
  const nikkiPage = await nikki.newPage();
  await signIn(nikkiPage, NIKKI);
  await nikkiPage.goto(xaniaUrl);
  await expect(nikkiPage.getByRole("heading", { name: "Xania" })).toBeVisible();
  await expect(nikkiPage.getByText("Your access: editor")).toBeVisible();
  await nikki.close();
});

test("owner signs in again with TOTP and sees the full, verified audit trail", async ({ page }) => {
  await signInAsOwner(page);
  await signOut(page);
  await signInAsOwner(page);
  await page.goto("/audit");
  await expect(page.getByTestId("chain-status")).toContainText("Hash chain verified");
  for (const action of [
    "auth.2fa.enabled",
    "project.created",
    "workspace.invite.created",
    "workspace.invite.accepted",
    "project.member.added",
    "auth.signed_out",
    "auth.password_verified_2fa_pending",
  ]) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }
  // Sequential ids with nothing hidden from the owner: no gaps that would look like deletions.
  const ids = (await page.getByTestId("audit-id").allTextContents()).map(Number);
  expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => ids[0] - i));
});
