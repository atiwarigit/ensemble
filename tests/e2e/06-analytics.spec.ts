import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { E2E_CRON_SECRET, MOCK_SPOTIFY_URL } from "../../playwright.config";
import { NIKKI, signIn, signInAsOwner } from "./helpers";

test.describe.configure({ mode: "serial" });

const ARTIST_URL = "https://open.spotify.com/artist/3XaniaMockArtistId0001?si=share";
const SAMPLES = path.join(__dirname, "../../samples/s4a");
let analyticsUrl = "";

async function openXaniaAnalytics(page: Page) {
  await page.getByRole("link", { name: "Analytics", exact: true }).click();
  await page.getByTestId("analytics-project").getByRole("link", { name: "Xania" }).click();
  await page.waitForURL(/\/analytics\/[0-9a-f-]{36}$/);
  analyticsUrl = new URL(page.url()).pathname;
}

test.beforeAll(async ({ request }) => {
  await request.post(`${MOCK_SPOTIFY_URL}/__reset`);
});

test("a lead links the Spotify artist through an owner approval, then the snapshot captures the catalogue", async ({ page }) => {
  await signInAsOwner(page);
  await openXaniaAnalytics(page);
  await expect(page.getByTestId("s4a-empty")).toBeVisible();
  await expect(page.getByText("No Spotify artist is linked to this project.")).toBeVisible();

  await page.getByLabel("Spotify artist link").fill(ARTIST_URL);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByTestId("artist-found").getByLabel("Spotify found")).toHaveValue("Xania");
  await page.getByRole("button", { name: "Request link" }).click();
  await page.getByLabel("Reason (optional)").fill("Our artist profile");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Request sent for approval.")).toBeVisible();
  await expect(page.getByTestId("pending-approval")).toContainText("Link the Spotify artist “Xania”");

  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  const req = page.getByTestId("approval-request").filter({ hasText: "Link the Spotify artist" });
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and done.")).toBeVisible();
  await expect(page.getByTestId("approval-history-row").first()).toContainText(/self-approved/i);

  await page.goto(analyticsUrl);
  await expect(page.getByTestId("linked-artist")).toContainText("Xania");
  await page.getByRole("button", { name: "Run snapshot now" }).click();
  await expect(page.getByText(/Snapshot saved: 4 tracks for 1 artist\. Spotify didn't include followers or popularity\./)).toBeVisible();
  await expect(page.getByTestId("dev-mode-notice")).toBeVisible();
  await expect(page.getByTestId("track-row")).toHaveCount(4);
  await expect(page.getByTestId("track-row").filter({ hasText: "Neon Saints" })).toContainText("USX9P2600002");
  await expect(page.getByTestId("alert-rule")).toHaveCount(4);
  await expect(page.getByTestId("alert-rule").filter({ hasText: "Popularity change" })).toContainText("can't fire");
});

test("an editor imports the Spotify for Artists timeline; the dashboard labels its source and date, and the streams alert fires", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto(analyticsUrl);
  await expect(page.getByRole("button", { name: "Run snapshot now" })).toHaveCount(0);
  await expect(page.getByLabel("Spotify artist link")).toHaveCount(0);

  await page.getByLabel("Spotify for Artists CSV").setInputFiles(path.join(SAMPLES, "xania-audience-timeline.csv"));
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/import\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("s4a-preview-summary")).toHaveText("249 new data points from Aug 1, 2026 to Oct 22, 2026");
  await page.getByRole("button", { name: "Import 249 data points" }).click();
  await expect(page.getByText(/Imported 249 data points\. 1 new alert\./)).toBeVisible();

  await page.goto(analyticsUrl);
  const s4aCard = page.locator("[data-slot=card]").filter({ hasText: "Streams and listeners" });
  await expect(s4aCard.getByTestId("source-label")).toHaveText(/Spotify for Artists CSV\s*as of Oct 22, 2026/);
  await expect(s4aCard.getByTestId("kpi").first()).toContainText("Streams, last 28 days");
  await expect(s4aCard.locator(".recharts-line")).toHaveCount(2);

  await expect(page.getByTestId("nav-badge-notifications")).toHaveText("1");
  await page.getByRole("link", { name: "Notifications" }).click();
  const note = page.getByTestId("notification").first();
  await expect(note).toContainText(/Streams up \d+% week over week/);
  await expect(note).toContainText("Spotify for Artists CSV, as of 2026-10-22");
  await page.getByRole("button", { name: "Mark all read" }).click();
  await expect(page.getByTestId("notification").first()).toHaveAttribute("data-read", "true");
  await expect(page.getByTestId("nav-badge-notifications")).toHaveCount(0);

  await page.goto(analyticsUrl);
  await page.getByLabel("Spotify for Artists CSV").setInputFiles(path.join(SAMPLES, "xania-audience-timeline.csv"));
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await expect(page.getByTestId("s4a-preview-summary")).toHaveText("0 new data points from Aug 1, 2026 to Oct 22, 2026");
  await expect(page.getByRole("button", { name: /^Import/ })).toBeDisabled();
  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForURL(analyticsUrl);
});

test("the Analytics agent answers why streams changed, citing the release and the source date", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto("/chat");
  await page.getByLabel("Scope").selectOption({ label: "Xania" });
  await page.getByRole("button", { name: "Start chat" }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
  await page.getByLabel("Message").fill("/why");
  await page.getByRole("button", { name: "Send" }).click();
  const step = page.locator(`[data-tool="analytics_explainChange"]`);
  await expect(step).toHaveAttribute("data-state", "done", { timeout: 30_000 });
  await expect(step).toContainText(/Streams rose \d+%/);
  await expect(step).toContainText("album “Glass Rivers” released 2026-10-17");
  await expect(step).toContainText("can't show what caused it");
});

test("with extended access, followers and popularity are charted instead of the Development Mode notice", async ({ page, request }) => {
  await request.post(`${MOCK_SPOTIFY_URL}/__control`, { data: { mode: "extended" } });
  await signInAsOwner(page);
  await page.goto(analyticsUrl);
  await page.getByRole("button", { name: "Run snapshot now" }).click();
  await expect(page.getByText(/^Snapshot saved: 4 tracks for 1 artist\.$/)).toBeVisible();
  await expect(page.getByTestId("dev-mode-notice")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Popularity" })).toBeVisible();
  await request.post(`${MOCK_SPOTIFY_URL}/__reset`);
});

test("cron endpoints need the secret, and admin-only pages stay hidden from members", async ({ page, request, browser }) => {
  expect((await request.get("/api/cron/retention", { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.get("/api/cron/audit-verify", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/audit-verify", { headers: { authorization: `Bearer ${E2E_CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ ok: true });

  await signInAsOwner(page);
  await page.getByRole("link", { name: "System" }).click();
  await expect(page.getByTestId("job-row").filter({ hasText: "Audit-chain verification" })).toContainText("OK");

  const nikki = await (await browser.newContext()).newPage();
  await signIn(nikki, NIKKI);
  await expect(nikki.getByRole("link", { name: "System" })).toHaveCount(0);
  expect((await nikki.goto("/settings/system"))?.status()).toBe(404);
  await nikki.context().close();
});

test("ten wrong passwords lock that email out for a while", async ({ page }) => {
  await page.goto("/sign-in");
  for (let i = 0; i < 10; i++) {
    await page.getByLabel("Email").fill("ghost@ensemble.local");
    await page.getByLabel("Password").fill(`wrong-password-${i}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /invalid/i })).toBeVisible();
  }
  await page.getByLabel("Password").fill("wrong-password-again");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(/Too many attempts\. Try again in \d+ minutes\./)).toBeVisible();
});
