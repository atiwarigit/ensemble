// Records the Milestone 2 demo: bank CSV import, dedupe on re-import, budgets/reports, revert.
// Prereqs: dev server on BASE_URL, Romel enrolled in 2FA (DEMO_TOTP_SECRET), a project named "Xania".
// Usage: DEMO_TOTP_SECRET=... node scripts/demo/milestone-2.mjs <out.mp4>
import path from "node:path";
import { signIn, startDemo } from "./lib.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "milestone-2-demo.mp4";
const CHASE = path.resolve(import.meta.dirname, "../../samples/bank-csv/chase-checking-2026-10.csv");

const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
try {
  await page.goto("/sign-in");
  await caption("Milestone 2: expenses and bank CSV import. Romel signs in with password + 2FA.");
  await signIn(page, "romel@ensemble.local", "ensemble-dev-password", process.env.DEMO_TOTP_SECRET);

  await page.getByRole("link", { name: "Expenses" }).first().click();
  await page.waitForURL("**/expenses");
  await caption("Expenses start empty. Import a Chase checking statement (a sample CSV).");

  await page.getByRole("link", { name: "Import CSV" }).first().click();
  await page.waitForURL("**/expenses/import");
  await page.getByLabel("CSV file").setInputFiles(CHASE);
  await page.getByLabel("Assign to project").click();
  await page.getByRole("option", { name: "Xania" }).click();
  await caption("Assign the whole statement to the Xania project, then preview.", 1500);
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/expenses\/import\/[0-9a-f-]{36}$/);
  await caption("Columns, date format and sign convention are detected from the headers.", 2500);

  await page.getByTestId("preview-totals").scrollIntoViewIfNeeded();
  await caption("12 expenses to import. The transfer, refund and royalty credit are excluded.", 3000);
  await scroll(500);
  await caption("Rules categorize known vendors (Suno, Kling, Meta…). Two identical Meta charges both count.", 3500);
  await scroll(-2000);
  await page.getByRole("button", { name: "Import 12 expenses" }).click();
  await page.getByTestId("batch-summary").waitFor();
  await caption("Committed in one transaction: 12 imported, one audit event.", 2500);

  await page.getByRole("link", { name: "View imported expenses" }).click();
  await page.getByTestId("expense-row").first().waitFor();
  await pause(300);
  await caption("The imported expenses, with category, project and masked account.", 3000);

  await page.goto("/expenses/import");
  await caption("Upload the same statement into Xania again…", 300);
  await page.getByLabel("CSV file").setInputFiles(CHASE);
  await page.getByLabel("Assign to project").click();
  await page.getByRole("option", { name: "Xania" }).click();
  await pause(800);
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/expenses\/import\/[0-9a-f-]{36}$/);
  await page.getByTestId("preview-totals").scrollIntoViewIfNeeded();
  await caption("…every row is flagged as a duplicate, so nothing would be imported twice.", 3500);
  await scroll(-2000);
  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForURL("**/expenses/import");

  await page.getByRole("navigation", { name: "Expense sections" }).getByRole("link", { name: "Budgets" }).click();
  await page.waitForURL("**/expenses/budgets");
  await caption("Set a $500 monthly budget for Xania (alert at 80%).", 300);
  await page.getByLabel("Amount (USD)").fill("500");
  await pause(1200);
  await page.getByRole("button", { name: "Save budget" }).click();
  await page.getByTestId("budget").first().waitFor();
  await pause(1500);

  await page.getByRole("navigation", { name: "Expense sections" }).getByRole("link", { name: "Reports" }).click();
  await page.waitForURL("**/expenses/reports**");
  await caption("Reports: monthly spend by category, budget vs. actual, and generation costs.", 3500);
  await scroll(600);
  await caption("Category × month table, exportable as CSV.", 2500);
  await scroll(-2000);

  await page.getByRole("link", { name: "Import CSV" }).first().click();
  await page.waitForURL("**/expenses/import");
  await caption("Open the committed import from the history…", 1200);
  await page.getByRole("link", { name: "chase-checking-2026-10.csv" }).first().click();
  await page.waitForURL(/\/expenses\/import\/[0-9a-f-]{36}$/);
  await caption("Made a mistake? Reverting the whole batch goes through an approval.", 2200);
  await page.getByRole("button", { name: "Request revert" }).click();
  await page.getByLabel("Reason (optional)").fill("Demo: undo this import");
  await page.getByRole("button", { name: "Send request" }).click();
  await page.getByTestId("pending-approval").waitFor();
  await page.getByRole("link", { name: "Approvals" }).click();
  await page.waitForURL("**/approvals");
  await caption("As workspace owner, Romel can approve his own request; it's flagged as self-approved.", 2500);
  await page.getByTestId("approval-request").first().getByRole("button", { name: "Approve" }).click();
  await page.getByText("Approved and done.").waitFor();
  await caption("Reverted: the 12 expenses are archived and the file can be re-imported later.", 3000);

  await page.goto("/audit");
  await caption("Every step is in the hash-chained audit log.", 3000);
  await scroll(400);
  await pause(1500);
} finally {
  await finish(out);
}
console.log(`Saved ${out}`);
