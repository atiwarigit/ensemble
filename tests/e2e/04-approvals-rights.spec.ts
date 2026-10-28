import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { NIKKI, signIn, signInAsOwner } from "./helpers";

test.describe.configure({ mode: "serial" });

const sha256 = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
let workUrl = "";
let projectUrl = "";

async function openPaperLanterns(page: Page) {
  await page.goto("/lyrics?q=Paper");
  await page.getByRole("link", { name: "Paper Lanterns" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  workUrl = new URL(page.url()).pathname;
}

test("the songwriter previews a draft package, then requests finalization and AI access", async ({ page }) => {
  await signIn(page, NIKKI);
  await openPaperLanterns(page);
  await page.getByRole("link", { name: "Rights package" }).click();
  await page.waitForURL(/\/rights$/);
  await expect(page.getByTestId("timeline-row")).toHaveCount(3);
  await expect(page.getByTestId("excerpt-row").first()).toBeVisible();
  await expect(page.getByText("Chain verified")).toBeVisible();
  await page.getByRole("button", { name: "Generate draft package" }).click();
  await expect(page.getByText("Draft package generated.")).toBeVisible();
  await expect(page.getByTestId("rights-package")).toHaveCount(1);
  await expect(page.getByTestId("rights-package")).toContainText("Draft");

  await page.goto(workUrl);
  await page.getByRole("button", { name: "Request finalization" }).click();
  await page.getByLabel("Reason (optional)").fill("Ready to register with the PRO");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByTestId("pending-approval")).toContainText("Finalize “Paper Lanterns”");
  await expect(page.getByRole("button", { name: "Finalization requested" })).toBeDisabled();

  await page.goto("/approvals");
  const mine = page.getByTestId("approval-request").filter({ hasText: "Paper Lanterns" });
  await expect(mine).toContainText("Requested by you");
  await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.goto("/projects");
  await page.getByRole("link", { name: "Nikki Songs" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  projectUrl = new URL(page.url()).pathname;
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByTestId("llm-lyrics-status")).toHaveText("Off");
  await page.getByRole("button", { name: "Request to turn on" }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("button", { name: "Approval requested" })).toBeDisabled();
});

test("the owner approves both from the queue", async ({ page }) => {
  await signInAsOwner(page);
  await expect(page.getByTestId("nav-badge-approvals")).toHaveText("2");
  await page.getByRole("link", { name: "Approvals" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for your decision (2)" })).toBeVisible();

  const finalize = page.getByTestId("approval-request").filter({ hasText: "Paper Lanterns" });
  await expect(finalize).toContainText("Ready to register with the PRO");
  await finalize.getByLabel("Decision note").fill("Checked the split with Nikki");
  await finalize.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and done.")).toBeVisible();

  const llm = page.getByTestId("approval-request").filter({ hasText: "Let AI models read the lyrics" });
  await llm.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing needs your approval.")).toBeVisible();
  await expect(page.getByTestId("approval-history-row")).toHaveCount(3);
  await expect(page.getByTestId("nav-badge-approvals")).toHaveCount(0);

  await page.goto(`${projectUrl}/settings`);
  await expect(page.getByTestId("llm-lyrics-status")).toHaveText("On");
});

test("the final package downloads, and its hashes match the files and the audit log", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(workUrl);
  await expect(page.getByTestId("work-status")).toHaveText("Final");
  await expect(page.getByTestId("final-alert")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit lyrics" })).toHaveCount(0);

  await page.getByRole("link", { name: "Rights package" }).click();
  const final = page.getByTestId("rights-package").filter({ hasText: "Final" });
  await expect(final).toHaveCount(1);
  const href = await final.getByTestId("package-download").getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const zip = await res.body();
  await expect(final).toContainText(`ZIP SHA-256 ${sha256(zip)}`);

  const files = unzipSync(new Uint8Array(zip));
  const sums = strFromU8(files.SHA256SUMS);
  await expect(final.getByTestId("sha256sums")).toHaveText(sums, { useInnerText: false });
  for (const line of sums.trim().split("\n")) {
    const [hash, name] = line.split(/\s+/);
    expect(sha256(files[name]), name).toBe(hash);
  }
  expect(strFromU8(files["rights-package.pdf"].slice(0, 5))).toBe("%PDF-");
  expect(Object.keys(files)).toEqual(expect.arrayContaining(["evidence/01-notebook-page-2019.jpg", "versions/v003.txt"]));

  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.kind).toBe("final");
  expect(manifest.audit.chainVerified).toBe(true);
  expect(manifest.contributors.map((c: { name: string; sharePct: number }) => `${c.name} ${c.sharePct}`)).toEqual([
    "Nikki 50",
    "Dee Rivers 50",
  ]);

  // Every version's text hash and its audit event hash must match what the audit log shows.
  await page.goto("/audit?action=lyric.version.created");
  const auditHash = new Map<string, string>();
  for (const row of await page.getByTestId("audit-row").all()) {
    const id = (await row.getByTestId("audit-id").textContent())!.trim();
    auditHash.set(id, (await row.locator("td").last().getAttribute("title"))!);
  }
  for (const v of manifest.versions) {
    expect(sha256(files[v.file])).toBe(v.contentSha256);
    expect(auditHash.get(String(v.auditEventId))).toBe(v.auditEventHash);
  }

  await page.goto("/audit?action=rights.");
  await expect(page.getByText("rights.package.downloaded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("rights.package.generated", { exact: true }).first()).toBeVisible();
});

test("changing the split on a final work needs approval; an owner's self-approval is flagged", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(workUrl);
  const editor = page.getByTestId("contributors");
  await editor.getByLabel("Contributor 1 share").fill("60");
  await editor.getByLabel("Contributor 2 share").fill("40");
  await editor.getByRole("button", { name: "Request change" }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByTestId("pending-approval")).toContainText("Nikki 60%, Dee Rivers 40%");

  await page.goto("/approvals");
  const req = page.getByTestId("approval-request").filter({ hasText: "Change the split" });
  await expect(req).toContainText("This is your own request");
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and done.")).toBeVisible();
  await expect(page.getByTestId("approval-history-row").first()).toContainText("Self-approved");

  await page.goto(`${workUrl}/rights`);
  await expect(page.getByTestId("rights-package").filter({ hasText: "Final" })).toHaveCount(2);
});
