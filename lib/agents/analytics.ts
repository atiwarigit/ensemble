import { z } from "zod";
import { db } from "@/db";
import { S4A_METRICS } from "@/lib/csv/s4a-csv";
import { analyticsProjects, compareTracks, describeExplain, describeTrends, explainChange, getTrends, SOURCE } from "@/lib/services/analytics";
import { invalid } from "@/lib/services/context";
import { defineTool, type Agent, type ToolContext } from "./types";

const projectArg = z.string().max(120).optional().describe("Project name; needed only when the chat isn't scoped to a project");
const daysArg = (d: number) => z.coerce.number().int().min(1).max(365).default(d).describe(`Window in days (default ${d})`);

async function pickProject(tc: ToolContext, name?: string) {
  const all = await analyticsProjects(db, tc.ctx);
  if (tc.projectId) {
    const p = all.find((x) => x.id === tc.projectId);
    if (!p) throw invalid("This project isn't available.");
    return p;
  }
  if (name) {
    const n = name.trim().toLowerCase();
    const p = all.find((x) => x.name.toLowerCase() === n) ?? all.find((x) => x.artistNames?.toLowerCase().includes(n));
    if (!p) throw invalid(`No project or linked artist called “${name}”.`);
    return p;
  }
  const withData = all.filter((p) => p.artists > 0 || p.s4aAsOf);
  if (withData.length === 1) return withData[0];
  if (!withData.length) throw invalid("No project has a linked Spotify artist or imported Spotify for Artists data yet. Set that up on the Analytics page.");
  throw invalid(`Which project? These have streaming data: ${withData.map((p) => p.name).join(", ")}.`);
}

const link = (projectId: string) => [{ href: `/analytics/${projectId}`, label: "Open analytics" }];

const trends = defineTool({
  name: "getTrends",
  description: `Streams, listeners, saves and followers over a window vs the window before (${SOURCE.s4a}), plus Spotify followers/popularity when Spotify shares them (${SOURCE.webApi}). Every figure comes with its source and as-of date.`,
  risk: "read",
  input: z.object({ project: projectArg, days: daysArg(28) }),
  async run(tc, { project, days }) {
    const p = await pickProject(tc, project);
    const t = await getTrends(db, tc.ctx, p.id, days);
    return { summary: `${p.name}: ${describeTrends(t)}`, data: t, links: link(p.id) };
  },
});

const compare = defineTool({
  name: "compareTracks",
  description: `Ranks songs by streams (or another metric) over a window, with the change vs the window before and the matching lyric work when the ISRC matches. Source: ${SOURCE.s4a}.`,
  risk: "read",
  input: z.object({ project: projectArg, days: daysArg(28), metric: z.enum(S4A_METRICS).default("streams") }),
  async run(tc, { project, days, metric }) {
    const p = await pickProject(tc, project);
    const c = await compareTracks(db, tc.ctx, p.id, { days, metric });
    if (!c.asOf || !c.rows.length) {
      return { summary: `${p.name}: no per-song Spotify for Artists data yet. Import the Songs export or a song's timeline.`, data: c, links: link(p.id) };
    }
    const top = c.rows
      .slice(0, 5)
      .map((r, i) => `${i + 1}. ${r.name} ${r.total.toLocaleString("en-US")}${r.change !== null ? ` (${r.change >= 0 ? "+" : ""}${r.change}%)` : ""}`)
      .join("; ");
    return {
      summary: `${p.name}, ${metric} in the ${days} days to ${c.asOf}: ${top} [${SOURCE.s4a}, as of ${c.asOf}].`,
      data: c,
      links: link(p.id),
    };
  },
});

const explain = defineTool({
  name: "explainChange",
  description:
    "Explains a change in streams (or another metric): compares the last N days with the N before, and lists releases and marketing spend in that period. Reports coincidences only, never causes.",
  risk: "read",
  input: z.object({ project: projectArg, days: daysArg(7), metric: z.enum(S4A_METRICS).default("streams") }),
  async run(tc, { project, days, metric }) {
    const p = await pickProject(tc, project);
    const e = await explainChange(db, tc.ctx, p.id, { days, metric });
    const links = [...link(p.id), ...(e.marketing.length ? [{ href: `/expenses?projectId=${p.id}`, label: "Expenses" }] : [])];
    return { summary: `${p.name}: ${describeExplain(e)}`, data: e, links };
  },
});

export const analyticsAgent: Agent = {
  id: "analytics",
  label: "Analytics",
  description: "Streaming numbers from Spotify for Artists exports and the daily Spotify snapshot, with sources and dates.",
  tools: [trends, compare, explain],
};
