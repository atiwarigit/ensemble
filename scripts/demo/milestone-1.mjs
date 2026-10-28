// Records the Milestone 1 demo: forced 2FA, private projects, invites, isolation, audit log.
// Prereqs: a freshly seeded database and a dev server on BASE_URL.
// Usage: node scripts/demo/milestone-1.mjs <out.mp4>
import { freshTotp, signIn, startDemo } from "./lib.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "ensemble-dev-password";
const out = process.argv[2] ?? "milestone-1-demo.mp4";

const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
const signOut = async () => {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in**");
};

try {
  await page.goto("/projects");
  await page.waitForURL("**/sign-in**");
  await caption("Milestone 1: foundation. Signed-out visitors are sent to sign-in (there is no public sign-up).", 3000);

  await page.getByLabel("Email").fill("romel@ensemble.local");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/setup-2fa");
  await caption("Romel is a workspace owner, so he must turn on 2FA before going further.", 2500);
  await page.getByLabel("Confirm your password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent()).trim();
  await caption("Scan the QR code with an authenticator app, then enter the 6-digit code.", 2500);
  await page.getByLabel("3. Enter the 6-digit code to finish").fill(await freshTotp(page, secret));
  await page.getByRole("button", { name: "Turn on 2FA" }).click();
  await page.getByRole("heading", { name: /Welcome back, Romel/ }).waitFor();
  await caption("2FA is on. This is the dashboard.", 1800);

  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Xania");
  await page.getByLabel("Artist name").fill("Xania");
  await caption("Create a private project for the artist Xania.", 1500);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  const xaniaPath = new URL(page.url()).pathname;
  await caption("Projects are private: only members (and workspace owners) can see them. Romel is lead.", 3000);

  await page.goto("/settings/members");
  await page.getByLabel("Email").fill("sam@example.com");
  await caption("Sign-up is invite-only. Romel invites Sam to the workspace.", 1500);
  await page.getByRole("button", { name: "Create invite" }).click();
  const inviteUrl = (await page.getByTestId("invite-url").textContent()).trim();
  await caption("Without email configured, the single-use invite link is shown to copy.", 2500);
  await signOut();

  await page.goto(new URL(inviteUrl).pathname);
  await caption("Sam opens the invite link and sets a password.", 1200);
  await page.getByLabel("Your name").fill("Sam");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: /Welcome back, Sam/ }).waitFor();
  await caption("Sam is in the workspace but can't see Xania until a lead adds him.", 2500);
  await signOut();

  await signIn(page, "nikki@ensemble.local", PASSWORD);
  await page.goto("/projects");
  await caption("Nikki (songwriter, member) doesn't see Xania in her projects…", 2200);
  await page.goto(xaniaPath);
  await caption("…and opening its URL directly returns Not Found, so its existence isn't leaked.", 2800);
  await page.goto("/");
  await signOut();

  await signIn(page, "romel@ensemble.local", PASSWORD, secret);
  await caption("Romel signs back in: password, then a fresh 2FA code.", 1500);
  await page.goto(xaniaPath);
  await page.getByLabel("Person to add").click();
  await page.getByRole("option", { name: /Nikki/ }).click();
  await caption("He adds Nikki to Xania as an editor.", 1200);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByTestId("project-member").nth(1).waitFor();
  await pause(1500);

  await page.goto("/audit");
  await page.getByTestId("chain-status").waitFor();
  await caption("Every action is in the append-only audit log. The hash chain is re-verified on load.", 3500);
  await page.getByText("View change").first().click();
  await caption("Each event records who, what, when and the before/after data.", 2500);
  await scroll(500);
  await pause(1500);
} finally {
  await finish(out);
}
console.log(`Saved ${out}`);
