// A stand-in for the Anthropic Messages API and the OpenAI Responses API, speaking each one's real
// streaming wire format. It "decides" which tools to call from keywords, then answers from the tool
// results, so the app's provider code, tool loop and fallback run end to end without real keys.
//
//   ANTHROPIC_BASE_URL=http://localhost:4010/anthropic/v1
//   OPENAI_BASE_URL=http://localhost:4010/openai/v1
//
// POST /__control {"fail":{"provider":"anthropic","status":529,"times":1}}  makes the next call(s) fail.
// GET  /__calls                                                             per-provider request counts.
// POST /__reset                                                             clears failures and counts.
import http from "node:http";
import { pathToFileURL } from "node:url";

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|this month|last month|\d{4}-\d{2})\b/;

function planTools(text) {
  const t = text.toLowerCase();
  const month = t.match(MONTHS)?.[1];
  const title = text.match(/["“]([^"”]+)["”]/)?.[1];
  const calls = [];
  if (title && /\b(suggest|rhyme|improve|tighten|rework|punch up)\b/.test(t)) {
    return [{ name: "lyrics_readLyricText", input: { title } }];
  }
  if (/\b(spen[dt]|spending|expenses?|costs?|paid)\b/.test(t) && !/\bbudget/.test(t)) {
    calls.push({ name: "finance_summarizeSpend", input: month ? { month } : {} });
  }
  if (/\bbudgets?\b/.test(t)) calls.push({ name: "finance_budgetStatus", input: month ? { month } : {} });
  if (/\b(missing|without|lack|need|still)\b.*\b(final|rights)\b/.test(t)) {
    calls.push({ name: "lyrics_listWorks", input: { missingFinalPackage: true } });
  }
  if (title && /\b(history|versions?)\b/.test(t)) calls.push({ name: "lyrics_lyricHistory", input: { title } });
  if (title && /\bfinali[sz]e\b/.test(t)) calls.push({ name: "lyrics_requestFinalization", input: { title } });
  if (/\b(streams?|listeners?|trend|analytics|spotify)\b/.test(t)) calls.push({ name: "analytics_getTrends", input: {} });
  return calls;
}

function suggestionFor(text) {
  const lines = text.split("\n");
  const last = [...lines].reverse().find((l) => l.trim());
  return { suggestion: `${text.trimEnd()}\n${last ?? ""}`, kind: "structure", rationale: "Repeats the final line as a tag so the ending lands." };
}

const parseJson = (s) => {
  try {
    return typeof s === "string" ? JSON.parse(s) : s;
  } catch {
    return s;
  }
};

/** What came back from tools after the latest user message: [{name, output}] */
function conversation(provider, body) {
  let userText = "";
  let results = [];
  if (provider === "anthropic") {
    const names = new Map();
    for (const m of body.messages ?? []) {
      const parts = typeof m.content === "string" ? [{ type: "text", text: m.content }] : (m.content ?? []);
      for (const p of parts) if (p.type === "tool_use") names.set(p.id, p.name);
      const toolResults = parts.filter((p) => p.type === "tool_result");
      if (m.role === "user" && toolResults.length === 0) {
        userText = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n");
        results = [];
      }
      for (const r of toolResults) {
        const raw = typeof r.content === "string" ? r.content : (r.content ?? []).map((c) => c.text ?? "").join("");
        results.push({ name: names.get(r.tool_use_id), output: parseJson(raw) });
      }
    }
  } else {
    const names = new Map();
    for (const item of body.input ?? []) {
      if (item.type === "function_call") names.set(item.call_id, item.name);
      else if (item.type === "function_call_output") results.push({ name: names.get(item.call_id), output: parseJson(item.output) });
      else if (item.role === "user") {
        const c = item.content;
        userText = typeof c === "string" ? c : (c ?? []).map((p) => p.text ?? "").join("\n");
        results = [];
      }
    }
  }
  return { userText, results };
}

const LABEL = { finance: "Finance", lyrics: "Lyrics", analytics: "Analytics" };

function decide(provider, body) {
  const { userText, results } = conversation(provider, body);
  const available = new Set((body.tools ?? []).map((t) => t.name));
  if (results.length === 0) {
    const calls = planTools(userText).filter((c) => available.has(c.name));
    if (calls.length) return { calls };
    return {
      text: "I can look up spending and budgets (Finance agent), lyric history and rights packages (Lyrics agent). What would you like to know?",
    };
  }
  const read = results.find((r) => r.name === "lyrics_readLyricText")?.output;
  const proposed = results.some((r) => r.name === "lyrics_proposeLyricEdit");
  if (read && !proposed && available.has("lyrics_proposeLyricEdit")) {
    if (read.data?.text) return { calls: [{ name: "lyrics_proposeLyricEdit", input: { title: read.data.title, ...suggestionFor(read.data.text) } }] };
  }
  const lines = results.map(({ name, output }) => {
    const agent = LABEL[String(name).split("_")[0]] ?? "Agent";
    const summary = output?.summary ?? output?.error ?? "No result.";
    const links = (output?.links ?? []).map((l) => `[${l.label}](${l.href})`).join(" · ");
    return `- **${agent}:** ${summary}${links ? ` ${links}` : ""}`;
  });
  return { text: `Here's what I found:\n\n${lines.join("\n")}` };
}

const chunksOf = (s, n = 24) => s.match(new RegExp(`[\\s\\S]{1,${n}}`, "g")) ?? [""];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokens = (s) => Math.max(1, Math.ceil(s.length / 4));
let seq = 0;
const id = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

async function streamAnthropic(res, body, plan) {
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const inTokens = tokens(JSON.stringify(body));
  send("message_start", {
    message: { id: id("msg"), type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inTokens, output_tokens: 0 } },
  });
  let out = 0;
  if (plan.text) {
    send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    for (const c of chunksOf(plan.text)) {
      send("content_block_delta", { index: 0, delta: { type: "text_delta", text: c } });
      await sleep(15);
    }
    send("content_block_stop", { index: 0 });
    out += tokens(plan.text);
  } else {
    plan.calls.forEach((call, index) => {
      const json = JSON.stringify(call.input);
      send("content_block_start", { index, content_block: { type: "tool_use", id: id("toolu"), name: call.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json } });
      send("content_block_stop", { index });
      out += tokens(json);
    });
  }
  send("message_delta", { delta: { stop_reason: plan.text ? "end_turn" : "tool_use", stop_sequence: null }, usage: { output_tokens: out } });
  send("message_stop", {});
  res.end();
}

async function streamOpenAI(res, body, plan) {
  let n = 0;
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: n++, ...data })}\n\n`);
  const response = { id: id("resp"), object: "response", created_at: Math.floor(Date.now() / 1000), model: body.model, status: "in_progress", output: [] };
  send("response.created", { response });
  const inTokens = tokens(JSON.stringify(body));
  let out = 0;
  const output = [];
  if (plan.text) {
    const itemId = id("msg");
    send("response.output_item.added", { output_index: 0, item: { type: "message", id: itemId, role: "assistant", status: "in_progress", content: [] } });
    for (const c of chunksOf(plan.text)) {
      send("response.output_text.delta", { item_id: itemId, output_index: 0, content_index: 0, delta: c, logprobs: [] });
      await sleep(15);
    }
    const item = { type: "message", id: itemId, role: "assistant", status: "completed", content: [{ type: "output_text", text: plan.text, annotations: [] }] };
    send("response.output_item.done", { output_index: 0, item });
    output.push(item);
    out += tokens(plan.text);
  } else {
    plan.calls.forEach((call, i) => {
      const args = JSON.stringify(call.input);
      const base = { type: "function_call", id: id("fc"), call_id: id("call"), name: call.name };
      send("response.output_item.added", { output_index: i, item: { ...base, arguments: "", status: "in_progress" } });
      send("response.function_call_arguments.delta", { item_id: base.id, output_index: i, delta: args });
      const item = { ...base, arguments: args, status: "completed" };
      send("response.output_item.done", { output_index: i, item });
      output.push(item);
      out += tokens(args);
    });
  }
  send("response.completed", {
    response: {
      ...response,
      status: "completed",
      output,
      incomplete_details: null,
      usage: { input_tokens: inTokens, input_tokens_details: { cached_tokens: 0 }, output_tokens: out, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: inTokens + out },
    },
  });
  res.end();
}

export function createMockLlmServer() {
  const failures = { anthropic: [], openai: [] };
  const calls = { anthropic: 0, openai: 0 };
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? parseJson(raw) : {};
    const url = req.url ?? "";
    if (url === "/__control" && req.method === "POST") {
      const f = body.fail;
      if (f) for (let i = 0; i < (f.times ?? 1); i++) failures[f.provider].push(f.status ?? 500);
      res.writeHead(204).end();
      return;
    }
    if (url === "/__reset") {
      failures.anthropic = [];
      failures.openai = [];
      calls.anthropic = calls.openai = 0;
      res.writeHead(204).end();
      return;
    }
    if (url === "/__calls") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(calls));
      return;
    }
    if (url === "/health") {
      res.writeHead(200).end("ok");
      return;
    }
    const provider = url.startsWith("/anthropic/") && url.endsWith("/messages") ? "anthropic" : url.startsWith("/openai/") && url.endsWith("/responses") ? "openai" : null;
    if (!provider || req.method !== "POST") {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `mock: no route ${req.method} ${url}` } }));
      return;
    }
    calls[provider]++;
    const key = provider === "anthropic" ? req.headers["x-api-key"] : String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!key) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "missing key" } }));
      return;
    }
    const failStatus = failures[provider].shift();
    if (failStatus) {
      const err =
        provider === "anthropic"
          ? { type: "error", error: { type: failStatus === 529 ? "overloaded_error" : "api_error", message: `mock failure ${failStatus}` } }
          : { error: { message: `mock failure ${failStatus}`, type: "server_error", code: null, param: null } };
      res.writeHead(failStatus, { "content-type": "application/json" }).end(JSON.stringify(err));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const plan = decide(provider, body);
    await (provider === "anthropic" ? streamAnthropic(res, body, plan) : streamOpenAI(res, body, plan));
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.MOCK_LLM_PORT ?? 4010);
  createMockLlmServer().listen(port, () => console.log(`mock LLM server on http://localhost:${port}`));
}
