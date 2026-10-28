import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { rightsPackages } from "@/db/schema/approvals";
import { formatTimestamp, shortHash } from "@/lib/format";
import { requestApproval } from "@/lib/services/approvals";
import { invalid } from "@/lib/services/context";
import { createWork, getWork, listVersions, listWorks, STATUS_LABEL } from "@/lib/services/lyrics";
import { listProjects } from "@/lib/services/projects";
import { generateDraftPackage, listPackages } from "@/lib/services/rights";
import { createSuggestion } from "@/lib/services/suggestions";
import type { ProjectRole } from "@/db/schema/tenancy";
import { hasProjectRole } from "@/lib/services/access";
import { defineTool, type Agent, type ToolContext } from "./types";

const ORIGIN_TEXT = {
  human: "human",
  human_edit_of_ai_suggestion: "human edit of an AI suggestion",
  imported_original: "older original",
} as const;

const titleArg = z.string().trim().min(1).max(200).describe("The lyric's title (case-insensitive; a unique partial match works)");

async function worksInScope(tc: ToolContext) {
  return listWorks(db, tc.ctx, tc.projectId ? { projectId: tc.projectId } : {});
}

/** Exact title match first, then a unique partial match. */
export async function findWork(tc: ToolContext, title: string) {
  const works = await worksInScope(tc);
  const needle = title.trim().replace(/^["“']|["”']$/g, "").toLowerCase();
  const exact = works.filter((w) => w.title.toLowerCase() === needle);
  if (exact.length === 1) return exact[0];
  const partial = works.filter((w) => w.title.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0];
  if (!partial.length && !exact.length) throw invalid(`No lyric called “${title}” in scope.`);
  const names = (exact.length ? exact : partial).map((w) => `“${w.title}” (${w.projectName})`).join(", ");
  throw invalid(`“${title}” matches more than one lyric: ${names}. Use the full title.`);
}

const list = defineTool({
  name: "listWorks",
  description:
    "Lists lyric works in scope with status, latest version and whether a final rights package exists. Use missingFinalPackage to find works that still need finalizing.",
  risk: "read",
  input: z.object({
    status: z.enum(["draft", "final", "released", "any"]).optional(),
    missingFinalPackage: z.boolean().optional().describe("Only works without a final rights package"),
  }),
  async run(tc, { status, missingFinalPackage }) {
    let works = await worksInScope(tc);
    const finals = works.length
      ? await db
          .selectDistinct({ workId: rightsPackages.workId })
          .from(rightsPackages)
          .where(and(eq(rightsPackages.kind, "final"), inArray(rightsPackages.workId, works.map((w) => w.id))))
      : [];
    const hasFinal = new Set(finals.map((f) => f.workId));
    if (status && status !== "any") works = works.filter((w) => w.status === status);
    if (missingFinalPackage) works = works.filter((w) => !hasFinal.has(w.id));
    const items = works.map((w) => ({
      title: w.title,
      project: w.projectName,
      status: w.status,
      latestVersion: w.latestVersion,
      hasFinalRightsPackage: hasFinal.has(w.id),
    }));
    const label = missingFinalPackage ? "without a final rights package" : status && status !== "any" ? `with status ${status}` : "in scope";
    return {
      summary: items.length
        ? `${items.length} lyric${items.length === 1 ? "" : "s"} ${label}: ${items
            .map((i) => `“${i.title}” (${STATUS_LABEL[i.status].toLowerCase()}, ${i.latestVersion ? `v${i.latestVersion}` : "no text yet"})`)
            .join(", ")}.`
        : `No lyrics ${label}.`,
      data: { works: items },
      links: works.slice(0, 5).map((w) => ({ href: `/lyrics/${w.id}`, label: w.title })),
    };
  },
});

const history = defineTool({
  name: "lyricHistory",
  description: "Version history of one lyric: version numbers, server timestamps, authors, origin and SHA-256. Does not include the text.",
  risk: "read",
  input: z.object({ title: titleArg }),
  async run(tc, { title }) {
    const w = await findWork(tc, title);
    const versions = await listVersions(db, tc.ctx, w.id);
    const items = versions.map(({ version: v, authorName }) => ({
      versionNo: v.versionNo,
      recordedAt: v.recordedAt.toISOString(),
      author: authorName,
      origin: v.origin,
      sha256: v.contentSha256,
      changeNote: v.changeNote,
      authorStatedWrittenAt: v.claimedWrittenAt,
    }));
    const latest = items[0];
    return {
      summary: latest
        ? `“${w.title}” has ${items.length} version${items.length === 1 ? "" : "s"}. Latest is v${latest.versionNo}, recorded ${formatTimestamp(
            latest.recordedAt,
          )} by ${latest.author ?? "unknown"} (${ORIGIN_TEXT[latest.origin]}), SHA-256 ${shortHash(latest.sha256)}.`
        : `“${w.title}” has no versions yet.`,
      data: { title: w.title, status: w.status, versions: items },
      links: [{ href: `/lyrics/${w.id}`, label: `Open “${w.title}”` }],
    };
  },
});

async function pickProject(tc: ToolContext, name?: string) {
  const projects = (await listProjects(db, tc.ctx)).filter(
    (p) => !p.archivedAt && (tc.ctx.workspaceRole === "owner" || hasProjectRole(p.myRole as ProjectRole | null, "editor")),
  );
  if (tc.projectId) {
    const p = projects.find((x) => x.id === tc.projectId);
    if (!p) throw invalid("You can't add lyrics to this project.");
    return p;
  }
  if (name) {
    const p = projects.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!p) throw invalid(`No project called “${name}” that you can write to.`);
    return p;
  }
  if (projects.length === 1) return projects[0];
  throw invalid(`Which project? You can write to: ${projects.map((p) => p.name).join(", ")}.`);
}

const create = defineTool({
  name: "createDraftLyric",
  description:
    "Creates an empty draft lyric work with a title. The assistant never writes the lyrics themselves; the author adds the first version.",
  risk: "write",
  input: z.object({
    title: titleArg,
    project: z.string().max(120).optional().describe("Project name; needed only when the chat isn't scoped to a project"),
  }),
  async run(tc, { title, project }) {
    const p = await pickProject(tc, project);
    const { work } = await createWork(tc.ctx, { projectId: p.id, title: title.replace(/^["“']|["”']$/g, "") });
    return {
      summary: `Created the draft lyric “${work.title}” in ${p.name}. It has no text yet; open it to write the first version.`,
      data: { workId: work.id, title: work.title, project: p.name },
      links: [{ href: `/lyrics/${work.id}`, label: `Open “${work.title}”` }],
    };
  },
});

const exportRights = defineTool({
  name: "exportRights",
  description:
    "Rights documentation for a lyric. For a final work, links its final package; for a draft, generates a watermarked draft package.",
  risk: "write",
  input: z.object({ title: titleArg }),
  async run(tc, { title }) {
    const w = await findWork(tc, title);
    const packages = await listPackages(db, tc.ctx, w.id);
    const final = packages.find((p) => p.pkg.kind === "final")?.pkg;
    if (w.status !== "draft") {
      if (!final) throw invalid(`“${w.title}” is ${w.status} but has no final package.`);
      return {
        summary: `“${w.title}” is final. Its latest final rights package is ${final.filename} (SHA-256 ${shortHash(final.zipSha256)}).`,
        data: { packageId: final.id, kind: "final", zipSha256: final.zipSha256 },
        links: [
          { href: `/api/rights/packages/${final.id}`, label: `Download ${final.filename}` },
          { href: `/lyrics/${w.id}/rights`, label: "Rights page" },
        ],
      };
    }
    const pkg = await db.transaction((tx) => generateDraftPackage(tx, tc.ctx, w.id));
    return {
      summary: `Generated a DRAFT rights package for “${w.title}” (${pkg.filename}). It's watermarked; finalizing the work issues the final package.`,
      data: { packageId: pkg.id, kind: "draft", zipSha256: pkg.zipSha256 },
      links: [
        { href: `/api/rights/packages/${pkg.id}`, label: `Download ${pkg.filename}` },
        { href: `/lyrics/${w.id}/rights`, label: "Rights page" },
      ],
    };
  },
});

const finalize = defineTool({
  name: "requestFinalization",
  description:
    "Asks for a lyric to be finalized (locks text and split, issues the final rights package). This never finalizes directly: it files an approval request for a project lead or owner.",
  risk: "gated",
  input: z.object({ title: titleArg, reason: z.string().max(500).optional() }),
  async run(tc, { title, reason }) {
    const w = await findWork(tc, title);
    const req = await requestApproval(tc.ctx, "lyric.finalize", { workId: w.id }, reason ?? "Requested from chat");
    return {
      summary: `Filed approval request for finalizing “${w.title}”. It's pending until a project lead or owner approves it in Approvals.`,
      data: { approvalId: req.id, status: req.status },
      approvalId: req.id,
      links: [{ href: "/approvals", label: "Open Approvals" }],
    };
  },
});

const readText = defineTool({
  name: "readLyricText",
  description:
    "Returns the latest text of a lyric. Only works in projects where an owner has turned on AI access to lyrics; otherwise it explains that the text is private.",
  risk: "read",
  llmOnly: true,
  input: z.object({ title: titleArg }),
  async run(tc, { title }) {
    const w = await findWork(tc, title);
    const { project } = await getWork(db, tc.ctx, w.id);
    if (!project.settings.allow_llm_on_lyrics) {
      return {
        summary: `The text of “${w.title}” is private: AI access to lyrics is off for ${project.name}. An owner can turn it on in the project settings.`,
        data: { private: true },
      };
    }
    const [latest] = await listVersions(db, tc.ctx, w.id);
    if (!latest) return { summary: `“${w.title}” has no text yet.`, data: { private: false, text: null } };
    return {
      summary: `Read v${latest.version.versionNo} of “${w.title}” (${latest.version.body.split("\n").length} lines).`,
      data: { private: false, title: w.title, versionNo: latest.version.versionNo, text: latest.version.body },
    };
  },
});

const suggest = defineTool({
  name: "proposeLyricEdit",
  description:
    "Saves a suggested revision (full replacement text) for a draft lyric so the author can review it. It does not change the lyric; a person must accept it. Call readLyricText first.",
  risk: "write",
  llmOnly: true,
  input: z.object({
    title: titleArg,
    kind: z.enum(["structure", "rhyme", "edit"]),
    suggestion: z.string().min(1).max(50_000).describe("The complete suggested lyric text"),
    rationale: z.string().max(1000).optional().describe("One or two sentences explaining the change"),
  }),
  async run(tc, { title, kind, suggestion, rationale }) {
    if (!tc.llm) throw invalid("Suggestions come from an AI model, which isn't in use for this message.");
    const w = await findWork(tc, title);
    const { suggestion: s, baseVersionNo } = await createSuggestion(
      tc.ctx,
      w.id,
      { kind, suggestion, rationale },
      { ...tc.llm, threadId: tc.threadId },
    );
    return {
      summary: `Saved a ${kind} suggestion for “${w.title}” based on v${baseVersionNo}. It's waiting for the author to accept, edit or dismiss it.`,
      data: { suggestionId: s.id, baseVersionNo },
      links: [{ href: `/lyrics/${w.id}#suggestions`, label: "Review the suggestion" }],
    };
  },
});

export const lyricsAgent: Agent = {
  id: "lyrics",
  label: "Lyrics",
  description: "Lyric works, version history, authorship, rights packages and finalization requests.",
  tools: [list, history, create, exportRights, finalize, readText, suggest],
};
