// Records the Milestone 5 demo in three segments, each against its own dev server:
//   1. no API keys  → slash commands and keyword routing
//   2. Anthropic only (pointed at tests/mocks/llm-server.mjs)
//   3. OpenAI only  (same mock)
// then joins them into one MP4.
// Prereqs: Postgres with the Milestone 3/4 demo data plus `pnpm exec tsx scripts/demo/milestone-5-prep.ts`,
// Romel enrolled in 2FA (DEMO_TOTP_SECRET), nothing else listening on :3200 / :4010.
// Usage: DEMO_TOTP_SECRET=... node scripts/demo/milestone-5.mjs <out.mp4>
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createMockLlmServer } from "../../tests/mocks/llm-server.mjs";
import { signIn, startDemo } from "./lib.mjs";

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;
const MOCK = "http://localhost:4010";
const out = path.resolve(process.argv[2] ?? "milestone-5-demo.mp4");
const work = "/tmp/m5-demo-segments";
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const mock = createMockLlmServer();
await new Promise((r) => mock.listen(4010, r));

async function withServer(env, fn) {
  const base = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_BASE_URL", "LLM_PROVIDER"]) delete base[k];
  const child = spawn("pnpm", ["exec", "next", "dev", "--port", String(PORT)], {
    env: {
      ...base,
      BETTER_AUTH_URL: BASE_URL,
      NEXT_PUBLIC_APP_URL: BASE_URL,
      NEXT_DIST_DIR: ".next-demo",
      ...env,
    },
    stdio: "ignore",
    detached: true,
  });
  try {
    for (let i = 0; i < 120; i++) {
      const ok = await fetch(`${BASE_URL}/sign-in`).then((r) => r.ok, () => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    // Warm the routes the demo uses so compile time doesn't show up in the video.
    for (const p of ["/sign-in", "/chat", "/settings/ai", "/audit", "/lyrics"]) await fetch(`${BASE_URL}${p}`).catch(() => {});
    await fn();
  } finally {
    process.kill(-child.pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function newChat(page, scope = "All my projects") {
  await page.goto("/chat");
  await page.getByLabel("Scope").selectOption({ label: scope });
  await page.getByRole("button", { name: "Start chat" }).click();
  await page.waitForURL(/\/chat\/[0-9a-f-]{36}$/);
}

async function ask(page, text, { typeDelay = 18 } = {}) {
  const before = await page.getByTestId("assistant-message").count();
  await page.getByLabel("Message").pressSequentially(text, { delay: typeDelay });
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.getByTestId("assistant-message").nth(before);
  await answer.getByTestId("answer-meta").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Send" }).locator(".animate-spin").waitFor({ state: "detached", timeout: 30_000 });
  return answer;
}

async function setProvider(page, label) {
  await page.getByRole("combobox", { name: "Provider" }).click();
  await page.getByRole("option", { name: label }).click();
  const save = page.getByRole("button", { name: "Save provider" });
  if (await save.isEnabled()) {
    await save.click();
    await page.getByText("Saved.").waitFor();
  }
}

const secret = process.env.DEMO_TOTP_SECRET;
const signInRomel = (page) => signIn(page, "romel@ensemble.local", "ensemble-dev-password", secret);

// ------------------------------------------------------------------------------------------------
await withServer({}, async () => {
  const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
  try {
    await page.goto("/sign-in");
    await caption("Milestone 5: coordinator chat. Part 1 of 3: the server has no AI keys at all.", 2800);
    await signInRomel(page);
    await page.goto("/settings/ai");
    await setProvider(page, /^Automatic/);
    await caption("Settings → AI assistant: neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set.", 3000);
    await newChat(page);
    await caption("Chat still works. Without a model it runs deterministic commands.", 2500);
    await page.getByRole("button", { name: "/expenses summary october" }).click();
    await page.getByTestId("answer-meta").first().waitFor();
    await caption("The Finance agent's tool ran directly. The badge says: Commands (no AI model).", 3200);
    await ask(page, "What did we spend this month, and which songs still lack final rights docs?");
    await caption("Plain words are matched to tools too. This one fans out to Finance and Lyrics.", 3200);
    await scroll(500);
    await pause(1500);
    const formAnswer = await ask(page, "/export rights");
    await caption("A command missing its argument asks for it.", 1800);
    await formAnswer.getByTestId("command-form").locator("select").selectOption("Glass Rivers");
    await formAnswer.getByRole("button", { name: "Run /export rights" }).click();
    await page.getByTestId("assistant-message").nth(3).locator('[data-tool="lyrics_exportRights"]').waitFor();
    await scroll(600);
    await caption("It generated a draft rights package and linked it.", 2500);
    await finish(path.join(work, "1-no-keys.mp4"));
  } catch (err) {
    await page.screenshot({ path: path.join(work, "fail-1.png") }).catch(() => {});
    throw err;
  }
});

// ------------------------------------------------------------------------------------------------
await withServer({ ANTHROPIC_API_KEY: "demo-key", ANTHROPIC_BASE_URL: `${MOCK}/anthropic/v1` }, async () => {
  const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
  try {
    await page.goto("/sign-in");
    await caption("Part 2 of 3: only ANTHROPIC_API_KEY is set (pointed at a local mock of the Anthropic API).", 3200);
    await signInRomel(page);
    await page.goto("/settings/ai");
    await caption("Anthropic is the primary provider; OpenAI has no key, so there's no fallback.", 3000);
    await newChat(page);
    const a = await ask(page, "How much did we spend in October, and are we within budget? Which songs are missing final rights packages?");
    await caption("The coordinator calls tools from both agents, then writes one answer. Each step is shown.", 3500);
    await scroll(500);
    await caption("The answer is labelled with the provider, model, agents used and estimated cost.", 3000);
    void a;

    await newChat(page, "Nikki Songs");
    await caption("In Nikki Songs, an owner has allowed AI to read lyrics.", 2200);
    const s = await ask(page, 'Can you suggest a stronger ending for "Glass Rivers"?');
    await caption("The Lyrics agent reads the text, then saves a suggestion. It does not edit the lyric.", 3500);
    await s.getByRole("link", { name: "Review the suggestion" }).first().click();
    await page.waitForURL(/#suggestions/);
    await page.locator("#suggestions").scrollIntoViewIfNeeded();
    await caption("On the lyric page: the suggested change as a diff, against the version it was based on.", 3200);
    const box = page.getByLabel("Edit before accepting").first();
    await box.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" (paper wings)", { delay: 40 });
    await caption("A person can edit it first, then accept.", 1600);
    await page.getByRole("button", { name: /Accept as v/ }).first().click();
    await page.getByText(/Saved as v/).waitFor();
    await page.getByTestId("version-row").first().scrollIntoViewIfNeeded();
    await caption("Saved as a new version, marked “Human edit of an AI suggestion”. The rights package reports it.", 3800);

    await page.goto("/audit?action=agent.");
    await caption("Every agent step is in the audit log, attributed to the agent and the person it acted for.", 3500);
    await pause(1000);
    await finish(path.join(work, "2-anthropic.mp4"));
  } catch (err) {
    await page.screenshot({ path: path.join(work, "fail-2.png") }).catch(() => {});
    throw err;
  }
});

// ------------------------------------------------------------------------------------------------
await withServer({ OPENAI_API_KEY: "demo-key", OPENAI_BASE_URL: `${MOCK}/openai/v1` }, async () => {
  const { page, caption, pause, scroll, finish } = await startDemo(BASE_URL);
  try {
    await page.goto("/sign-in");
    await caption("Part 3 of 3: only OPENAI_API_KEY is set (pointed at a local mock of the OpenAI Responses API).", 3200);
    await signInRomel(page);
    await page.goto("/settings/ai");
    await caption("Now OpenAI is primary. No code or config change, just the environment.", 2800);
    await newChat(page);
    await ask(page, "What did we spend on generation this month, and which works still lack a final rights package?");
    await caption("Same question, same agents, answered through OpenAI.", 2800);
    await scroll(500);
    await pause(1200);

    await fetch(`${MOCK}/__control`, { method: "POST", body: JSON.stringify({ fail: { provider: "openai", status: 503 } }) });
    await ask(page, "How is the budget looking this month?");
    await caption("When the provider fails (here a simulated 503) and there's no fallback, chat answers with commands and says why.", 4000);

    await page.goto("/settings/ai");
    await scroll(700);
    await caption("Every model call is logged with tokens and estimated cost, against a monthly budget.", 3200);
    await scroll(-700);
    await page.getByLabel("Monthly budget (USD)").fill("50");
    await caption("Raising the budget needs an owner's approval; lowering it is immediate.", 2800);
    await finish(path.join(work, "3-openai.mp4"));
  } catch (err) {
    await page.screenshot({ path: path.join(work, "fail-3.png") }).catch(() => {});
    throw err;
  }
});

mock.close();
const list = path.join(work, "list.txt");
writeFileSync(list, ["1-no-keys.mp4", "2-anthropic.mp4", "3-openai.mp4"].map((f) => `file '${path.join(work, f)}'`).join("\n"));
const joined = path.join(work, "joined.mp4");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", joined]);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync("cp", [joined, out]);
console.log("wrote", out);
process.exit(0);
