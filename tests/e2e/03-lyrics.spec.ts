import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { NIKKI, signIn } from "./helpers";

test.describe.configure({ mode: "serial" });

const SAMPLES = path.join(__dirname, "../../samples/lyrics");
const POEM = readFileSync(path.join(SAMPLES, "paper-lanterns-2019.txt"), "utf8").trim();
const NOTEBOOK = path.join(SAMPLES, "notebook-page-2019.jpg");
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/;

let projectId = "";
let workUrl = "";

async function saveVersion(page: Page, body: string, note: string) {
  await page.goto(`${workUrl}/edit`);
  await expect(page.getByRole("button", { name: /Save version/ })).toBeEnabled();
  await page.getByRole("textbox", { name: "Lyrics" }).fill(body);
  await page.getByLabel("What changed? (optional)").fill(note);
  await page.getByRole("button", { name: /Save version/ }).click();
  await expect(page.getByTestId("saved-alert")).toBeVisible();
}

test("a songwriter enters an older poem with the date she wrote it", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Nikki Songs");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  projectId = new URL(page.url()).pathname.split("/").pop()!;

  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Lyrics" }).click();
  await page.getByRole("link", { name: "New lyric" }).click();
  await page.waitForURL(/\/lyrics\/new/);
  await page.getByLabel("Title", { exact: true }).fill("Paper Lanterns");
  await page.getByText("An older poem or lyric").click();
  await page.getByLabel("Date written").fill("2019-06-01");
  await page.getByRole("textbox", { name: "Lyrics" }).fill(POEM);
  await page.getByRole("button", { name: "Save lyric" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  workUrl = new URL(page.url()).pathname;

  await expect(page.getByTestId("current-lyrics")).toHaveText(POEM);
  const row = page.getByTestId("version-row");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Older original, entered");
  await expect(row).toContainText("Written Jun 1, 2019 (stated by the author)");
  await expect(row).toContainText(sha256(POEM).slice(0, 12));
});

test("each edit becomes a new timestamped, hashed version and the history shows the diff", async ({ page }) => {
  await signIn(page, NIKKI);
  const v2 = POEM.replace("hung it on the fire escape for you", "hung it from the fire escape for you");
  const v3 = `${v2}\n\nAnd when the morning folds us too,\nI'll keep a little light for you.`;
  await saveVersion(page, v2, "Fixed a line in verse one");
  await expect(page.getByTestId("saved-alert")).toContainText(sha256(v2));
  await saveVersion(page, v3, "Added an outro");

  const rows = page.getByTestId("version-row");
  await expect(rows).toHaveCount(3);
  const expected = [v3, v2, POEM];
  for (let i = 0; i < 3; i++) {
    const recorded = (await rows.nth(i).locator("td").nth(1).textContent())!.trim();
    expect(recorded).toMatch(TIMESTAMP);
    await expect(rows.nth(i).locator("td").nth(4)).toHaveAttribute("title", sha256(expected[i]));
  }

  // Saving identical text is refused rather than creating an empty version.
  await page.goto(`${workUrl}/edit`);
  await page.getByRole("button", { name: "Save version 4" }).click();
  await expect(page.getByText("Nothing changed since the last version.")).toBeVisible();

  await page.goto(`${workUrl}/versions/3`);
  await expect(page.getByTestId("version-hash")).toHaveText(sha256(v3));
  await expect(page.getByTestId("diff").locator('[data-change="added"]')).toContainText("And when the morning folds us too");
  await page.getByRole("link", { name: "v1", exact: true }).click();
  await expect(page.getByTestId("diff").locator('[data-change="removed"]')).toHaveText("hung it on the fire escape for you,");
});

test("a notebook photo is attached as evidence with its fingerprint", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto(workUrl);
  await page.getByLabel("File (up to 10 MB)").setInputFiles(NOTEBOOK);
  await page.getByLabel("Description (optional)").fill("Page from my 2019 notebook");
  await page.getByRole("button", { name: "Attach evidence" }).click();
  await expect(page.getByText("Evidence attached.")).toBeVisible();

  const fileHash = sha256(readFileSync(NOTEBOOK));
  const item = page.getByTestId("evidence-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("notebook-page-2019.jpg");
  await expect(item).toContainText(fileHash.slice(0, 12));

  const href = await item.getByRole("link", { name: "notebook-page-2019.jpg" }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(sha256(await res.body())).toBe(fileHash);
});

test("a generation can't be logged until human lyrics exist, and then must cite a version", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto(`/lyrics/new?project=${projectId}`);
  await page.getByLabel("Title", { exact: true }).fill("Untitled hook");
  await page.getByRole("button", { name: "Save lyric" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  await expect(page.getByText("No lyrics yet", { exact: true })).toBeVisible();
  await page.getByLabel("Tool", { exact: true }).fill("Suno");
  await page.getByRole("button", { name: "Log generation" }).click();
  await expect(page.getByText("Log the human-written lyrics first.")).toBeVisible();
  await expect(page.getByTestId("generation-item")).toHaveCount(0);

  await page.goto(workUrl);
  await page.getByLabel("Tool", { exact: true }).fill("Suno");
  await page.getByRole("button", { name: "Log generation" }).click();
  await expect(page.getByText("Choose the lyric version this generation used.")).toBeVisible();
  await page.getByLabel("Lyrics used").click();
  await page.getByRole("option", { name: /^v3 ·/ }).click();
  await page.getByLabel("Link or ID (optional)").fill("https://suno.com/song/demo-paper-lanterns");
  await page.getByRole("button", { name: "Log generation" }).click();
  await expect(page.getByTestId("generation-item")).toContainText("Used v3");
});

test("the split must add up to 100% and changes are audited", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto(workUrl);
  const editor = page.getByTestId("contributors");
  await editor.getByRole("button", { name: "Outside writer" }).click();
  await editor.getByLabel("Contributor 2 name").fill("Dee Rivers");
  await editor.getByLabel("Contributor 2 share").fill("50");
  await editor.getByRole("button", { name: "Save split" }).click();
  await expect(page.getByText("Shares must add up to 100% (they add up to 150%).")).toBeVisible();
  await editor.getByLabel("Contributor 1 share").fill("50");
  await expect(page.getByTestId("share-total")).toHaveText("Total 100%");
  await editor.getByRole("button", { name: "Save split" }).click();
  await expect(page.getByText("Contributors saved.")).toBeVisible();

  await page.goto(`/projects/${projectId}/activity`);
  for (const action of ["lyric.work.created", "lyric.version.created", "lyric.evidence.added", "lyric.generation.logged", "lyric.contributors.updated"]) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }
});
