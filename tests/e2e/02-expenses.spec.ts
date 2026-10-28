import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { NIKKI, signIn, signInAsOwner, signOut } from "./helpers";

test.describe.configure({ mode: "serial" });

const CHASE = path.join(__dirname, "../../samples/bank-csv/chase-checking-2026-10.csv");
let projectId = "";

async function uploadChase(page: Page) {
  await page.goto(`/expenses/import?project=${projectId}`);
  await page.getByLabel("CSV file").setInputFiles(CHASE);
  await page.getByRole("button", { name: "Upload and preview" }).click();
  await page.waitForURL(/\/expenses\/import\/[0-9a-f-]{36}$/);
}

function stat(page: Page, testId: string, label: string) {
  return page.getByTestId(testId).locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd");
}

test("a member creates a project and imports a bank CSV into it", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Nikki Ads");
  await page.getByLabel("Artist name").fill("Nikki");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  projectId = new URL(page.url()).pathname.split("/").pop()!;

  await uploadChase(page);
  await expect(page.getByText("into Nikki Ads")).toBeVisible();
  await expect(stat(page, "preview-totals", "Will import")).toHaveText("12");
  await expect(stat(page, "preview-totals", "Duplicates (skipped)")).toHaveText("0");
  await page.getByRole("button", { name: "Import 12 expenses" }).click();
  await expect(stat(page, "batch-summary", "Imported")).toHaveText("12");

  await page.goto(`/expenses?project=${projectId}&month=2026-10`);
  await expect(page.getByTestId("expense-row")).toHaveCount(12);
});

test("re-importing the same file skips every row as a duplicate", async ({ page }) => {
  await signIn(page, NIKKI);
  await uploadChase(page);
  await expect(stat(page, "preview-totals", "Will import")).toHaveText("0");
  await expect(stat(page, "preview-totals", "Duplicates (skipped)")).toHaveText("12");
  await expect(page.getByRole("button", { name: "Import 0 expenses" })).toBeDisabled();
  await page.getByRole("button", { name: "Discard" }).click();
  await page.waitForURL(/\/expenses\/import$/);
});

test("budgets show spend against the limit in reports", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto("/expenses/budgets");
  await page.getByLabel("Amount (USD)").fill("100");
  await page.getByRole("button", { name: "Save budget" }).click();
  await expect(page.getByText("Budget saved").first()).toBeVisible();

  await page.goto(`/expenses/reports?project=${projectId}&month=2026-10`);
  await expect(page.getByTestId("budget").first()).toContainText("Over budget");
  await expect(page.getByTestId("report-category").first()).toBeVisible();
});

test("a revert is requested, approved by the owner, and the audit log records both", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto("/expenses/import");
  await page.getByRole("link", { name: "chase-checking-2026-10.csv" }).first().click();
  await page.getByRole("button", { name: "Request revert" }).click();
  await page.getByLabel("Reason (optional)").fill("Imported into the wrong project");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByTestId("pending-approval")).toContainText("Revert the import of chase-checking-2026-10.csv");
  await expect(page.getByRole("button", { name: "Revert requested" })).toBeDisabled();

  // Nikki leads this project, but a requester can't approve their own request.
  await page.goto("/approvals");
  const mine = page.getByTestId("approval-request").filter({ hasText: "chase-checking-2026-10.csv" });
  await expect(mine.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "Withdraw" })).toBeVisible();
  await signOut(page);

  await signInAsOwner(page);
  await expect(page.getByTestId("nav-badge-approvals")).toHaveText("1");
  await page.getByRole("link", { name: "Approvals" }).click();
  const request = page.getByTestId("approval-request").filter({ hasText: "chase-checking-2026-10.csv" });
  await expect(request).toContainText("Imported into the wrong project");
  await request.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and done.")).toBeVisible();
  await expect(page.getByTestId("approval-history-row").first()).toContainText("Approved · done");

  await page.goto(`/expenses?project=${projectId}&month=2026-10`);
  await expect(page.getByTestId("expense-row")).toHaveCount(0);

  await page.goto(`/projects/${projectId}/activity`);
  for (const action of [
    "import.uploaded",
    "import.committed",
    "import.discarded",
    "approval.requested",
    "approval.approved",
    "import.reverted",
    "approval.executed",
    "expense.budget.created",
  ]) {
    await expect(page.getByText(action, { exact: true }).first()).toBeVisible();
  }
});
