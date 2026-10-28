// Records the Milestone 4 demo: request finalization, the owner approves from the queue, then the
// final rights package downloads and its hashes are checked against the files and the audit log.
// Prereqs: dev server on BASE_URL with the Milestone 3 demo data ("Paper Lanterns" in "Nikki Songs"),
// Romel enrolled in 2FA (DEMO_TOTP_SECRET).
// Usage: DEMO_TOTP_SECRET=... node scripts/demo/milestone-4.mjs <out.mp4>
import { createHash } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import { signIn, startDemo } from "./lib.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "milestone-4-demo.mp4";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
try {
  await page.goto("/sign-in");
  await caption("Milestone 4: approvals and rights documentation. Nikki signs in.");
  await signIn(page, "nikki@ensemble.local", "ensemble-dev-password");

  await page.goto("/lyrics?q=Paper");
  await page.getByRole("link", { name: "Paper Lanterns" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  const workUrl = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Rights package" }).click();
  await page.waitForURL(/\/rights$/);
  await caption("The rights package preview: splits, authorship timeline, evidence, generations…", 2500);
  await scroll(700);
  await caption("…and an audit excerpt. Every version's hash ties to the audit event that recorded it.", 3000);
  await scroll(900);
  await pause(1500);

  await page.goto(workUrl);
  await caption("Finalizing locks the text and split. It needs someone else's approval.", 300);
  await page.getByRole("button", { name: "Request finalization" }).click();
  await page.getByLabel("Reason (optional)").fill("Ready to register with the PRO");
  await pause(1200);
  await page.getByRole("button", { name: "Send request" }).click();
  await page.getByTestId("pending-approval").waitFor();
  await caption("Requested. It waits in the approvals queue (and expires in 7 days if nobody decides).", 2800);

  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  await page.waitForURL("**/approvals");
  await caption("Nikki leads this project, but she can't approve her own request; she can only withdraw it.", 3200);

  await page.getByTestId("user-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL("**/sign-in");
  await caption("Romel (owner) signs in with password + 2FA.");
  await signIn(page, "romel@ensemble.local", "ensemble-dev-password", process.env.DEMO_TOTP_SECRET);
  await page.getByTestId("nav-badge-approvals").waitFor();
  await caption("The sidebar shows one request waiting for him.", 1800);
  await page.getByRole("link", { name: "Approvals", exact: true }).click();
  await page.waitForURL("**/approvals");
  const req = page.getByTestId("approval-request").filter({ hasText: "Paper Lanterns" });
  await req.getByLabel("Decision note").fill("Checked the 60/40 split with Nikki and Dee");
  await caption("He reviews the request and approves it with a note.", 1500);
  await req.getByRole("button", { name: "Approve" }).click();
  await page.getByText("Approved and done.").waitFor();
  await caption("Approved and executed under Romel's name. The decision and the execution are both audited.", 3000);

  await page.goto(workUrl);
  await page.getByTestId("final-alert").waitFor();
  await caption("The work is now Final: no more edits, and split changes need an approval.", 3000);

  await page.getByRole("link", { name: "Rights package" }).click();
  await page.waitForURL(/\/rights$/);
  const final = page.getByTestId("rights-package").filter({ hasText: "Final" });
  await final.locator("summary").click();
  await caption("The final package: PDF, manifest, each version's text, the notebook photo, and SHA256SUMS.", 3500);

  const href = await final.getByTestId("package-download").getAttribute("href");
  await final.getByTestId("package-download").hover();
  const zip = new Uint8Array(await (await page.request.get(href)).body());
  const files = unzipSync(zip);
  const sums = strFromU8(files.SHA256SUMS).trim().split("\n");
  const ok = sums.every((l) => {
    const [hash, name] = l.split(/\s+/);
    return sha256(files[name]) === hash;
  });
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  const versionsOk = manifest.versions.every((v) => sha256(files[v.file]) === v.contentSha256);
  await caption(
    `Downloaded and checked: ${ok ? `all ${sums.length} files match SHA256SUMS` : "SHA256SUMS MISMATCH"}; ` +
      `${versionsOk ? "every version's text matches its recorded hash" : "VERSION HASH MISMATCH"}.`,
    4000,
  );

  const ids = manifest.versions.map((v) => v.auditEventId);
  await page.goto("/audit?action=lyric.version.created");
  await page.getByTestId("audit-row").first().waitFor();
  const shown = new Map();
  for (const row of await page.getByTestId("audit-row").all()) {
    shown.set((await row.getByTestId("audit-id").textContent()).trim(), await row.locator("td").last().getAttribute("title"));
  }
  const auditOk = manifest.versions.every((v) => shown.get(String(v.auditEventId)) === v.auditEventHash);
  await page.getByTestId("audit-row").first().getByText("View change").click();
  await caption(
    `In the audit log, events #${ids.join(", #")} ${auditOk ? "carry exactly the hashes listed in the package" : "DON'T MATCH the package"}.`,
    4000,
  );

  await page.goto("/audit?action=approval.");
  await page.getByTestId("audit-row").first().waitFor();
  await caption("The approval trail: requested, approved (with note), executed.", 3000);
  await page.goto("/audit?action=rights.");
  await page.getByTestId("audit-row").first().waitFor();
  await caption("Package generation and every download are audited too.", 3000);
} finally {
  await finish(out);
}
console.log(`Saved ${out}`);
