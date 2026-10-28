import { expect, test, type Page } from "@playwright/test";
import { MOCK_LLM_URL, USING_MOCK_LLM } from "../../playwright.config";
import { NIKKI, signIn, signInAsOwner } from "./helpers";

test.describe.configure({ mode: "serial" });

const CROSS_DOMAIN = "What did we spend this month, and which songs still lack final rights docs?";

async function setProvider(page: Page, label: RegExp) {
  await page.goto("/settings/ai");
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: label }).click();
  const save = page.getByRole("button", { name: "Save provider" });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText("Saved.")).toBeVisible();
  }
}

async function newChat(page: Page, scope = "All my projects") {
  await page.goto("/chat");
  await page.getByLabel("Scope").selectOption({ label: scope });
  await page.getByRole("button", { name: "Start chat" }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
}

async function ask(page: Page, text: string) {
  const before = await page.getByTestId("assistant-message").count();
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.getByTestId("assistant-message").nth(before);
  await expect(answer.getByTestId("answer-meta")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Send" }).locator(".animate-spin")).toHaveCount(0, { timeout: 30_000 });
  return answer;
}

test("with the assistant off, chat answers with commands across both agents", async ({ page }) => {
  await signInAsOwner(page);
  await setProvider(page, /^Off/);
  await newChat(page);
  await expect(page.getByTestId("assistant-status")).toHaveAttribute("data-mode", "commands");

  const answer = await ask(page, CROSS_DOMAIN);
  await expect(answer.getByTestId("answer-meta")).toHaveAttribute("data-mode", "commands");
  await expect(answer.getByTestId("answer-meta")).toContainText("Commands (no AI model)");
  await expect(answer.locator('[data-testid="agent-step"][data-tool="finance_summarizeSpend"]')).toHaveAttribute("data-state", "done");
  await expect(answer.locator('[data-testid="agent-step"][data-tool="lyrics_listWorks"]')).toHaveAttribute("data-state", "done");

  // A command with a missing argument asks for it with a small form.
  const formAnswer = await ask(page, "/export rights");
  await formAnswer.getByTestId("command-form").locator("select").selectOption("Paper Lanterns");
  await formAnswer.getByRole("button", { name: "Run /export rights" }).click();
  const exported = page.getByTestId("assistant-message").nth(2);
  await expect(exported.locator('[data-testid="agent-step"][data-tool="lyrics_exportRights"]')).toContainText("final rights package", {
    timeout: 30_000,
  });

  // History survives a reload.
  await page.reload();
  await expect(page.getByTestId("assistant-message")).toHaveCount(3);
});

for (const provider of ["anthropic", "openai"] as const) {
  const label = provider === "anthropic" ? "Anthropic" : "OpenAI";
  test(`with ${label} selected, the coordinator routes the question to both agents`, async ({ page }) => {
    test.skip(!USING_MOCK_LLM && !process.env[`${provider.toUpperCase()}_API_KEY`], `no ${label} key`);
    await signInAsOwner(page);
    await setProvider(page, new RegExp(`^${label}$`));
    await expect(page.getByTestId(`provider-${provider}`)).toContainText("Primary");
    await newChat(page);
    await expect(page.getByTestId("assistant-status")).toHaveAttribute("data-provider", provider);
    const answer = await ask(page, CROSS_DOMAIN);
    await expect(answer.getByTestId("answer-meta")).toHaveAttribute("data-provider", provider);
    await expect(answer.getByTestId("answer-meta")).toContainText(label);
    await expect(answer.locator('[data-testid="agent-step"][data-tool="finance_summarizeSpend"]')).toBeVisible();
    await expect(answer.locator('[data-testid="agent-step"][data-tool="lyrics_listWorks"]')).toBeVisible();

    await page.goto("/settings/ai");
    await expect(page.getByTestId("llm-call").first()).toContainText(label);
  });
}

test("when Anthropic is overloaded, OpenAI answers and the notice says so", async ({ page, request }) => {
  test.skip(!USING_MOCK_LLM, "needs the mock provider to force a failure");
  await signInAsOwner(page);
  await setProvider(page, /^Automatic/);
  await newChat(page);
  await request.post(`${MOCK_LLM_URL}/__control`, { data: { fail: { provider: "anthropic", status: 529 } } });
  const answer = await ask(page, "How is the budget looking this month?");
  await expect(answer.getByTestId("answer-meta")).toHaveAttribute("data-provider", "openai");
  await expect(answer.getByTestId("answer-notice")).toContainText("Anthropic was unavailable, so OpenAI answered.");
  await page.goto("/settings/ai");
  await expect(page.getByTestId("llm-call").nth(1)).toContainText("error · 529");
});

test("the AI suggests an edit, and the songwriter accepts it as a new version", async ({ page }) => {
  await signIn(page, NIKKI);
  await page.goto("/lyrics/new");
  await page.getByLabel("Project").click();
  await page.getByRole("option", { name: "Nikki Songs" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Glass Rivers");
  await page.getByRole("textbox", { name: "Lyrics" }).fill("Under the bridge the water sings\nwe kept the light on paper wings");
  await page.getByRole("button", { name: "Save lyric" }).click();
  await page.waitForURL(/\/lyrics\/[0-9a-f-]{36}$/);
  const workUrl = new URL(page.url()).pathname;

  await newChat(page, "Nikki Songs");
  const answer = await ask(page, 'Can you suggest a stronger ending for "Glass Rivers"?');
  await expect(answer.locator('[data-testid="agent-step"][data-tool="lyrics_readLyricText"]')).toBeVisible();
  const proposed = answer.locator('[data-testid="agent-step"][data-tool="lyrics_proposeLyricEdit"]');
  await expect(proposed).toContainText("waiting for the author");
  await proposed.getByRole("link", { name: "Review the suggestion" }).click();
  await page.waitForURL(`**${workUrl}#suggestions`);

  const suggestion = page.getByTestId("suggestion");
  await expect(suggestion).toHaveAttribute("data-status", "open");
  await expect(suggestion.locator('[data-change="added"]')).toBeVisible();
  // The lyric itself hasn't changed.
  await expect(page.getByTestId("version-row")).toHaveCount(1);
  const box = suggestion.getByLabel("Edit before accepting");
  await box.fill(`${await box.inputValue()}\n(paper wings)`);
  await suggestion.getByRole("button", { name: "Accept as v2" }).click();
  await expect(page.getByText(/Saved as v2/)).toBeVisible();
  await expect(page.getByTestId("version-row")).toHaveCount(2);
  await expect(page.getByTestId("version-row").first()).toContainText("Human edit of an AI suggestion");
  await expect(page.getByTestId("current-lyrics")).toContainText("(paper wings)");
  await expect(suggestion).toHaveAttribute("data-status", "accepted");
});

test("agent actions are audited for the person they acted for, and the budget stops model calls", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/audit?action=agent.");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Finance agent for Romel" }).first()).toBeVisible();
  await page.goto("/audit?action=lyric.suggestion");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Lyrics agent for Nikki" }).first()).toContainText("lyric.suggestion.created");
  await expect(page.getByTestId("audit-row").filter({ hasText: "lyric.suggestion.accepted" }).first()).toContainText("Nikki");

  await page.goto("/settings/ai");
  await page.getByLabel("Monthly budget (USD)").fill("0");
  await page.getByRole("button", { name: "Lower budget" }).click();
  await expect(page.getByTestId("llm-budget")).toContainText("of $0 this month");
  await newChat(page);
  const answer = await ask(page, "What did we spend this month?");
  await expect(answer.getByTestId("answer-meta")).toHaveAttribute("data-mode", "commands");
  await expect(answer.getByTestId("answer-notice")).toContainText("budget");

  await page.goto("/settings/ai");
  await page.getByLabel("Monthly budget (USD)").fill("25");
  await page.getByRole("button", { name: "Request increase" }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await page.goto("/approvals");
  const req = page.getByTestId("approval-request").filter({ hasText: "Raise the monthly AI budget" });
  await req.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved and done.")).toBeVisible();
  await page.goto("/settings/ai");
  await expect(page.getByTestId("llm-budget")).toContainText("of $25 this month");
});
