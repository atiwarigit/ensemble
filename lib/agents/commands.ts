import { parseMonth } from "./dates";

export type PlannedCall = { tool: string; input: Record<string, unknown> };

export type CommandPlan =
  | { kind: "calls"; calls: PlannedCall[]; via: "slash" | "intent" }
  | { kind: "help" }
  /** A command is missing an argument; the UI shows a small form that re-sends the completed command. */
  | { kind: "form"; prompt: string; command: string; field: { name: string; label: string; options: "works" | null } }
  | { kind: "unknown" };

export const COMMAND_HELP: { usage: string; description: string }[] = [
  { usage: "/expenses summary [month]", description: "Spend by category and generation costs, e.g. /expenses summary october" },
  { usage: "/expenses list [search]", description: "Recent expenses, optionally matching a merchant" },
  { usage: "/budget [month]", description: "Budget vs. actual" },
  { usage: '/lyric new "Title"', description: "Create an empty draft lyric" },
  { usage: '/lyric history "Title"', description: "Versions with timestamps and hashes" },
  { usage: "/lyric list [missing]", description: "Lyrics, or those still missing a final rights package" },
  { usage: '/export rights "Title"', description: "Rights package (draft or final)" },
  { usage: '/finalize "Title"', description: "Request finalization (goes to Approvals)" },
];

/** `"Title"`, `“Title”` or the remaining words. */
function titleFrom(rest: string) {
  const quoted = rest.match(/["“']([^"”']+)["”']/);
  return (quoted ? quoted[1] : rest).trim();
}

function needTitle(command: string, prompt: string): CommandPlan {
  return { kind: "form", prompt, command, field: { name: "title", label: "Lyric", options: "works" } };
}

function slash(text: string): CommandPlan {
  const [head, ...words] = text.slice(1).trim().split(/\s+/);
  const cmd = head.toLowerCase();
  let sub = (words[0] ?? "").toLowerCase();
  let rest = words.slice(1).join(" ");

  switch (cmd) {
    case "help":
    case "?":
      return { kind: "help" };
    case "expenses":
    case "expense":
    case "spend": {
      if (sub === "list") return { kind: "calls", via: "slash", calls: [{ tool: "finance_listExpenses", input: rest ? { search: rest } : {} }] };
      if (sub !== "summary") rest = words.join(" ");
      const month = parseMonth(rest);
      if (rest && !month) {
        return { kind: "form", prompt: `Which month? I couldn't read “${rest}”.`, command: "/expenses summary", field: { name: "month", label: "Month (e.g. october)", options: null } };
      }
      return { kind: "calls", via: "slash", calls: [{ tool: "finance_summarizeSpend", input: month ? { month } : {} }] };
    }
    case "budget":
    case "budgets": {
      const month = parseMonth(words.join(" "));
      return { kind: "calls", via: "slash", calls: [{ tool: "finance_budgetStatus", input: month ? { month } : {} }] };
    }
    case "lyric":
    case "lyrics": {
      if (cmd === "lyrics" && !sub) sub = "list";
      if (sub === "list") {
        const missing = /missing|final|rights/.test(rest.toLowerCase());
        return { kind: "calls", via: "slash", calls: [{ tool: "lyrics_listWorks", input: missing ? { missingFinalPackage: true } : {} }] };
      }
      const title = titleFrom(rest);
      if (sub === "new" || sub === "create") {
        if (!title) return { kind: "form", prompt: "What's the new lyric called?", command: "/lyric new", field: { name: "title", label: "Title", options: null } };
        return { kind: "calls", via: "slash", calls: [{ tool: "lyrics_createDraftLyric", input: { title } }] };
      }
      if (sub === "history" || sub === "versions") {
        if (!title) return needTitle("/lyric history", "Which lyric's history?");
        return { kind: "calls", via: "slash", calls: [{ tool: "lyrics_lyricHistory", input: { title } }] };
      }
      return { kind: "help" };
    }
    case "export": {
      if (sub !== "rights") return { kind: "help" };
      const title = titleFrom(rest);
      if (!title) return needTitle("/export rights", "Rights package for which lyric?");
      return { kind: "calls", via: "slash", calls: [{ tool: "lyrics_exportRights", input: { title } }] };
    }
    case "finalize": {
      const title = titleFrom(words.join(" "));
      if (!title) return needTitle("/finalize", "Which lyric should be finalized?");
      return { kind: "calls", via: "slash", calls: [{ tool: "lyrics_requestFinalization", input: { title } }] };
    }
    default:
      return { kind: "unknown" };
  }
}

/** Plan §2 no-LLM mode: a keyword table maps free text to tools. Several matches fan out to several agents. */
function intents(text: string): CommandPlan {
  const t = text.toLowerCase();
  const calls: PlannedCall[] = [];
  const month = parseMonth(t);
  const title = text.match(/["“]([^"”]+)["”]/)?.[1];

  if (/\b(spen[dt]|spending|expenses?|costs?|paid|pay)\b/.test(t) && !/\bbudget/.test(t)) {
    calls.push({ tool: "finance_summarizeSpend", input: month ? { month } : {} });
  }
  if (/\bbudgets?\b/.test(t)) calls.push({ tool: "finance_budgetStatus", input: month ? { month } : {} });
  if (/\b(lack|lacking|missing|without|need|needs|still)\b.*\b(final|rights)\b|\brights packages?\b/.test(t) && !title) {
    calls.push({ tool: "lyrics_listWorks", input: { missingFinalPackage: true } });
  }
  if (title && /\b(history|versions?|timeline)\b/.test(t)) calls.push({ tool: "lyrics_lyricHistory", input: { title } });
  if (title && /\b(export|rights package|rights doc)/.test(t)) calls.push({ tool: "lyrics_exportRights", input: { title } });
  if (title && /\b(new|create|start)\b.*\b(lyric|song|poem)\b/.test(t)) calls.push({ tool: "lyrics_createDraftLyric", input: { title } });

  return calls.length ? { kind: "calls", via: "intent", calls } : { kind: "unknown" };
}

export function planCommand(text: string): CommandPlan {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "help" };
  return trimmed.startsWith("/") ? slash(trimmed) : intents(trimmed);
}
