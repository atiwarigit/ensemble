import { expect, type Page } from "@playwright/test";
import { totp } from "../../lib/totp";

export const PASSWORD = process.env.SEED_PASSWORD || "ensemble-dev-password";
export const ROMEL = process.env.BOOTSTRAP_OWNER_EMAIL || "romel@ensemble.local";
export const NIKKI = process.env.SEED_MEMBER_EMAIL || "nikki@ensemble.local";

/** TOTP secrets captured during enrolment, keyed by email, shared across tests in one run. */
export const secrets = new Map<string, string>();

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  const secret = secrets.get(email);
  if (secret) {
    await expect(page.getByText("Two-factor authentication")).toBeVisible();
    await page.getByLabel("Authentication code").fill(totp(secret));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
}

/** Signs in as Romel, enrolling TOTP first if this run hasn't yet. */
export async function signInAsOwner(page: Page) {
  await signIn(page, ROMEL);
  if (!secrets.has(ROMEL)) {
    await page.waitForURL("**/setup-2fa");
    await page.getByLabel("Confirm your password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set up authenticator" }).click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    secrets.set(ROMEL, secret);
    await page.getByLabel("3. Enter the 6-digit code to finish").fill(totp(secret));
    await page.getByRole("button", { name: "Turn on 2FA" }).click();
  }
  await expect(page.getByRole("heading", { name: /Welcome back, Romel/ })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in");
}
