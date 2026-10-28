// Records the Milestone 6 demo against one dev server pointed at the local Spotify mock
// (tests/mocks/spotify-server.mjs): link an artist through approval, the daily Web API snapshot in
// Development Mode, a Spotify for Artists CSV import with an alert, the Analytics agent, a captioned
// extended-access simulation, then the hardening pass (System page, sign-in lockout).
// Prereqs: Postgres with the Milestone 3–5 demo data plus `pnpm exec tsx scripts/demo/milestone-6-prep.ts`,
// Romel enrolled in 2FA (DEMO_TOTP_SECRET), nothing else listening on :3200 / :4020.
// Usage: DEMO_TOTP_SECRET=... node scripts/demo/milestone-6.mjs <out.mp4>
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { createMockSpotifyServer } from "../../tests/mocks/spotify-server.mjs";
import { signIn, startDemo } from "./lib.mjs";

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;
const MOCK = "http://localhost:4020";
const CRON_SECRET = "demo-cron-secret";
const out = path.resolve(process.argv[2] ?? "milestone-6-demo.mp4");
const secret = process.env.DEMO_TOTP_SECRET;
const SAMPLES = path.resolve("samples/s4a");

const mock = createMockSpotifyServer();
await new Promise((r) => mock.listen(4020, r));

const base = { ...process.env };
for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "LLM_PROVIDER"]) delete base[k];
const server = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
  env: {
    ...base,
    BETTER_AUTH_URL: BASE_URL,
    NEXT_PUBLIC_APP_URL: BASE_URL,
    NEXT_DIST_DIR: ".next-demo",
    CRON_SECRET,
    SPOTIFY_CLIENT_ID: "mock-client",
    SPOTIFY_CLIENT_SECRET: "mock-secret",
    SPOTIFY_API_BASE: MOCK,
    SPOTIFY_ACCOUNTS_BASE: MOCK,
  },
  stdio: "ignore",
  detached: true,
});

const control = (body) => fetch(`${MOCK}/__control`, { method: "POST", body: JSON.stringify(body) });

async function signOut(page) {
  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in");
}

try {
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${BASE_URL}/sign-in`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const p of ["/sign-in", "/analytics", "/approvals", "/notifications", "/chat", "/settings/system"]) await fetch(`${BASE_URL}${p}`).catch(() => {});
  // Populates the System page's job history.
  await fetch(`${BASE_URL}/api/cron/audit-verify`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  await fetch(`${BASE_URL}/api/cron/retention`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });

  const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
  try {
    // 1. Link the artist, then the Web API snapshot ------------------------------------------------
    await page.goto("/sign-in");
    await caption("Milestone 6: Spotify analytics. Spotify here is a local mock of its Web API, in Development Mode.", 3200);
    await signIn(page, "romel@ensemble.local", "ensemble-dev-password", secret);
    await page.getByRole("link", { name: "Analytics", exact: true }).click();
    await page.getByTestId("analytics-project").getByRole("link", { name: "Nikki Songs" }).click();
    await page.waitForURL(/\/analytics\/[0-9a-f-]{36}$/);
    const analyticsUrl = new URL(page.url()).pathname;
    await caption("No artist linked and no Spotify for Artists data yet.", 2200);
    await page.getByLabel("Spotify artist link").pressSequentially("https://open.spotify.com/artist/3XaniaMockArtistId0001", { delay: 10 });
    await page.getByRole("button", { name: "Check" }).click();
    await page.getByTestId("artist-found").waitFor();
    await caption("Ensemble looks the artist up first, so you can confirm it's the right one.", 2400);
    await page.getByRole("button", { name: "Request link" }).click();
    await page.getByLabel("Reason (optional)").fill("Xania's artist profile");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.getByTestId("pending-approval").waitFor();
    await caption("Linking an artist changes what gets collected, so it needs an owner's approval.", 2800);
    await page.getByRole("link", { name: "Approvals", exact: true }).click();
    await page.getByTestId("approval-request").filter({ hasText: "Link the Spotify artist" }).getByRole("button", { name: "Approve" }).click();
    await page.getByText("Approved and done.").waitFor();
    await caption("Romel is the owner, so he can approve his own request. The history flags it as self-approved.", 3000);

    await page.goto(analyticsUrl);
    await page.getByRole("button", { name: "Run snapshot now" }).click();
    await page.getByText(/Snapshot saved/).waitFor();
    await caption("The daily snapshot (a Vercel cron) can also be run by hand. It found 4 tracks.", 2800);
    await page.getByTestId("dev-mode-notice").scrollIntoViewIfNeeded();
    await caption("In Development Mode, Spotify no longer returns followers or popularity. The page says so instead of showing zeros.", 4000);
    await page.getByTestId("track-row").first().scrollIntoViewIfNeeded();
    await caption("ISRCs still come through, so tracks match the lyric works in the catalogue.", 3000);
    await page.getByTestId("alert-rule").first().scrollIntoViewIfNeeded();
    await caption("Alert rules: the popularity alert is marked as unable to fire under Development Mode.", 3000);

    // 2. Spotify for Artists CSV ------------------------------------------------------------------
    await signOut(page);
    await caption("Streams and listeners aren't in the Web API. They come from Spotify for Artists exports. Nikki signs in.", 3200);
    await signIn(page, "nikki@ensemble.local", "ensemble-dev-password");
    await page.goto(analyticsUrl);
    await page.getByLabel("Spotify for Artists CSV").setInputFiles(path.join(SAMPLES, "xania-audience-timeline.csv"));
    await page.getByRole("button", { name: "Upload and preview" }).click();
    await page.waitForURL(/\/import\/[0-9a-f-]{36}$/);
    await caption("The columns were recognised. The preview shows every data point before anything is saved.", 3000);
    await scroll(500);
    await pause(1000);
    await scroll(-500);
    await page.getByRole("button", { name: /^Import \d+ data points/ }).click();
    await page.getByText(/Imported \d+ data points\. \d+ new alert/).waitFor();
    await caption("Imported. Re-uploading the same file adds nothing: points are deduplicated by day.", 2800);
    await page.goto(analyticsUrl);
    await page.getByTestId("source-label").first().waitFor();
    await caption("Every figure says where it came from and how fresh it is: Spotify for Artists CSV, as of Oct 22.", 3500);
    await scroll(400);
    await pause(1500);
    await scroll(-400);
    await page.getByRole("link", { name: "Notifications" }).click();
    await page.getByTestId("notification").first().waitFor();
    await caption("The streams alert fired after the import: up week over week, with the source and date.", 3200);

    // 3. Analytics agent --------------------------------------------------------------------------
    await page.goto("/chat");
    await page.getByLabel("Scope").selectOption({ label: "Nikki Songs" });
    await page.getByRole("button", { name: "Start chat" }).click();
    await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
    await page.getByLabel("Message").pressSequentially("Why did streams jump last week?", { delay: 18 });
    await page.getByRole("button", { name: "Send" }).click();
    const step = page.locator('[data-tool="analytics_explainChange"]').first();
    await step.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-tool="analytics_explainChange"]')?.getAttribute("data-state") === "done");
    await step.scrollIntoViewIfNeeded();
    await caption("No AI key on this server, so the question is routed to the Analytics agent's tool directly.", 3200);
    await caption("It lines up what happened nearby: the album release and the ad spend. It doesn't claim either caused the jump.", 4200);

    // 4. Extended access (simulated) --------------------------------------------------------------
    await signOut(page);
    await control({ mode: "extended" });
    execFileSync("pnpm", ["exec", "tsx", "scripts/demo/milestone-6-prep.ts", "backdate"], { stdio: "ignore" });
    await caption("Simulation: the mock now answers as an app with Extended Quota access, with a snapshot from 8 days ago.", 3500);
    await signIn(page, "romel@ensemble.local", "ensemble-dev-password", secret);
    await page.goto(analyticsUrl);
    await page.getByRole("button", { name: "Run snapshot now" }).click();
    await page.getByText(/^Snapshot saved: 4 tracks for 1 artist\. \d+ new alerts?\.$/).waitFor();
    await page.getByRole("columnheader", { name: "Popularity" }).scrollIntoViewIfNeeded();
    await caption("With extended access, followers and popularity are captured and charted.", 2800);
    await page.getByRole("link", { name: "Notifications" }).click();
    await page.getByTestId("notification").first().waitFor();
    await caption("The popularity-drop and follower-milestone alerts fire, comparing with the earlier snapshot.", 3500);
    // What Vercel Cron does each morning; run before the mock leaves extended mode so today's figures stay.
    await fetch(`${BASE_URL}/api/cron/spotify`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    await control({ mode: "development" });

    // 5. Hardening --------------------------------------------------------------------------------
    await page.getByRole("link", { name: "System" }).click();
    await page.getByTestId("job-row").first().waitFor();
    await caption("Hardening. Settings → System (admins only): the last run of each cron job, which env vars are set, and the retention policy.", 4000);
    await scroll(600);
    await pause(1500);
    await signOut(page);
    await caption("Sign-in is rate limited. Ten wrong passwords for one email…", 2200);
    for (let i = 0; i < 10; i++) {
      await page.getByLabel("Email").fill("ghost@ensemble.local");
      await page.getByLabel("Password").fill(`wrong-password-${i}`);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.getByRole("alert").filter({ hasText: /invalid/i }).waitFor();
    }
    await page.getByLabel("Password").fill("one-more-guess");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText(/Too many attempts/).waitFor();
    await caption("…and that email is locked out for 15 minutes. The block is written to the audit log.", 3500);
    await finish(out);
  } catch (err) {
    await page.screenshot({ path: "/tmp/m6-demo-fail.png" }).catch(() => {});
    throw err;
  }
} finally {
  process.kill(-server.pid, "SIGTERM");
  mock.close();
}
