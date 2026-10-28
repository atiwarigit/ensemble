// Records the Milestone 3 demo: an older poem entered with its written date, two edits as immutable
// hashed versions, a diff, notebook evidence, the generation block, the split, then the owner's audit view.
// Prereqs: freshly seeded dev server on BASE_URL, Romel enrolled in 2FA (DEMO_TOTP_SECRET).
// Usage: DEMO_TOTP_SECRET=... node scripts/demo/milestone-3.mjs <out.mp4>
import { readFileSync } from "node:fs";
import path from "node:path";
import { signIn, startDemo } from "./lib.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "milestone-3-demo.mp4";
const SAMPLES = path.resolve(import.meta.dirname, "../../samples/lyrics");
const POEM = readFileSync(path.join(SAMPLES, "paper-lanterns-2019.txt"), "utf8").trim();
const V2 = POEM.replace("hung it on the fire escape for you", "hung it from the fire escape for you");
const V3 = `${V2}\n\nAnd when the morning folds us too,\nI'll keep a little light for you.`;

const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);

async function saveVersion(body, note) {
  await page.getByRole("link", { name: "Edit lyrics" }).click();
  await page.waitForURL(/\/edit$/);
  const save = page.getByRole("button", { name: /Save version/ });
  await save.waitFor();
  await page.waitForFunction(() => !document.querySelector("button[type=submit]")?.disabled);
  await page.getByRole("textbox", { name: "Lyrics" }).fill(body);
  await page.getByLabel("What changed? (optional)").fill(note);
  await pause(900);
  await save.click();
  await page.getByTestId("saved-alert").waitFor();
}

try {
  await page.goto("/sign-in");
  await caption("Milestone 3: lyrics and authorship. Nikki (songwriter) signs in.");
  await signIn(page, "nikki@ensemble.local", "ensemble-dev-password");

  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Nikki Songs");
  await caption("She starts a private project for her songs.", 1200);
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Lyrics" }).click();
  await page.waitForURL(/\/lyrics\?project=/);
  await page.getByRole("link", { name: "New lyric" }).click();
  await page.waitForURL(/\/lyrics\/new/);

  await caption("She enters a poem she wrote in 2019, with the date she wrote it.", 300);
  await page.getByLabel("Title", { exact: true }).fill("Paper Lanterns");
  await page.getByText("An older poem or lyric").click();
  await page.getByLabel("Date written").fill("2019-06-01");
  await page.getByRole("textbox", { name: "Lyrics" }).fill(POEM);
  await caption("The date is recorded as stated by the author. Ensemble proves when it recorded the text.", 2800);
  await page.getByRole("button", { name: "Save lyric" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  const workUrl = new URL(page.url()).pathname;
  await caption("Version 1: timestamped by the database clock and fingerprinted with SHA-256.", 3200);

  await caption("Two edits. Each save is a new version; earlier versions can't be changed.", 300);
  await saveVersion(V2, "Fixed a line in verse one");
  await saveVersion(V3, "Added an outro");
  await caption("Version 3 recorded, with its own server timestamp and hash.", 2200);
  await page.getByText("Version history").scrollIntoViewIfNeeded();
  await scroll(350);
  await caption("The history: recorded time (UTC, to the second), author, origin, hash and note.", 3500);

  await page.getByRole("link", { name: "v3", exact: true }).click();
  await page.waitForURL(/\/versions\/3/);
  await page.getByRole("link", { name: "v1", exact: true }).click();
  await page.waitForURL(/compare=1/);
  await caption("Any two versions can be compared line by line.", 3000);

  await page.goto(workUrl);
  await page.getByText("Evidence", { exact: true }).scrollIntoViewIfNeeded();
  await caption("She attaches a photo of the notebook page as evidence.", 300);
  await page.getByLabel("File (up to 10 MB)").setInputFiles(path.join(SAMPLES, "notebook-page-2019.jpg"));
  await page.getByLabel("Description (optional)").fill("Page from my 2019 notebook");
  await pause(800);
  await page.getByRole("button", { name: "Attach evidence" }).click();
  await page.getByTestId("evidence-item").waitFor();
  await caption("The file is stored with its own SHA-256 fingerprint. Downloads are audited.", 3000);

  await page.goto("/lyrics/new");
  await page.getByLabel("Title", { exact: true }).fill("Untitled hook");
  await caption("A new idea with no lyrics yet…", 1000);
  await page.getByRole("button", { name: "Save lyric" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  await page.getByText("AI generation log").scrollIntoViewIfNeeded();
  await page.getByLabel("Tool", { exact: true }).fill("Suno");
  await caption("…so logging a Suno generation is blocked: human lyrics must be recorded first.", 600);
  await page.getByRole("button", { name: "Log generation" }).click();
  await page.getByText("Log the human-written lyrics first.").waitFor();
  await pause(2800);

  await page.goto(workUrl);
  await page.getByText("AI generation log").scrollIntoViewIfNeeded();
  await caption("On Paper Lanterns, the generation is logged against version 3.", 300);
  await page.getByLabel("Tool", { exact: true }).fill("Suno");
  await page.getByLabel("Lyrics used").click();
  await page.getByRole("option", { name: /^v3 ·/ }).click();
  await page.getByLabel("Link or ID (optional)").fill("https://suno.com/song/paper-lanterns-demo");
  await pause(800);
  await page.getByRole("button", { name: "Log generation" }).click();
  await page.getByTestId("generation-item").waitFor();
  await pause(2000);

  await scroll(-3000);
  const editor = page.getByTestId("contributors");
  await caption("Splits: add a co-writer. Shares must add up to 100%.", 300);
  await editor.getByRole("button", { name: "Outside writer" }).click();
  await editor.getByLabel("Contributor 2 name").fill("Dee Rivers");
  await editor.getByLabel("Contributor 2 share").fill("40");
  await pause(600);
  await editor.getByRole("button", { name: "Save split" }).click();
  await page.getByText("Shares must add up to 100%").first().waitFor();
  await pause(1800);
  await editor.getByLabel("Contributor 1 share").fill("60");
  await pause(800);
  await editor.getByRole("button", { name: "Save split" }).click();
  await page.getByText("Contributors saved.").waitFor();
  await caption("60 / 40 saved. Every change to the split is in the audit log.", 2500);

  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in");
  await caption("Romel (owner) signs in with password + 2FA to review the record.");
  await signIn(page, "romel@ensemble.local", "ensemble-dev-password", process.env.DEMO_TOTP_SECRET);
  await page.goto("/audit?action=lyric.");
  await page.getByTestId("audit-id").first().waitFor();
  await caption("The audit log, filtered to lyrics: every version, file, generation and split change.", 3500);
  await page.goto(workUrl);
  await caption("Owners see every project, so Romel can open Nikki's lyric and its full history.", 3000);
} finally {
  await finish(out);
}
