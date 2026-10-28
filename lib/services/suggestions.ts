import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import { lyricSuggestions } from "@/db/schema/chat";
import { lyricVersions } from "@/db/schema/lyrics";
import { recordAudit } from "./audit";
import { invalid, notFound, type ServiceContext } from "./context";
import { sha256Hex } from "./files";
import { assertDraft, getWork, insertVersion, lyricBody, requireWorkRole } from "./lyrics";

export const SUGGESTION_KINDS = { structure: "Structure", rhyme: "Rhyme", edit: "Edit" } as const;

export const suggestionInput = z.object({
  kind: z.enum(["structure", "rhyme", "edit"]),
  suggestion: z.string(),
  rationale: z.string().trim().max(2000).optional().nullable(),
});

async function latestVersion(exec: Executor, workId: string) {
  const [v] = await exec
    .select()
    .from(lyricVersions)
    .where(eq(lyricVersions.workId, workId))
    .orderBy(desc(lyricVersions.versionNo))
    .limit(1);
  return v ?? null;
}

/**
 * Stores text an LLM proposed for a work. Only allowed where the project lets AI read lyrics, because
 * producing it required sending the lyric text to the provider.
 */
export async function createSuggestion(
  ctx: ServiceContext,
  workId: string,
  input: z.input<typeof suggestionInput>,
  meta: { provider: string; model: string; threadId?: string | null },
) {
  const data = suggestionInput.parse(input);
  const text = lyricBody.parse(data.suggestion);
  return db.transaction(async (tx) => {
    const { work, project } = await requireWorkRole(tx, ctx, workId, "editor");
    if (!project.settings.allow_llm_on_lyrics) {
      throw invalid("AI access to lyrics is off for this project, so the assistant can't suggest changes.");
    }
    assertDraft(work, "the text");
    const base = await latestVersion(tx, workId);
    if (!base) throw invalid("This work has no lyrics yet. A person has to write the first version.");
    if (sha256Hex(text) === base.contentSha256) throw invalid("The suggestion is the same as the current version.");
    const [row] = await tx
      .insert(lyricSuggestions)
      .values({
        workspaceId: ctx.workspaceId,
        workId,
        baseVersionId: base.id,
        kind: data.kind,
        suggestion: text,
        rationale: data.rationale || null,
        provider: meta.provider,
        model: meta.model,
        threadId: meta.threadId ?? null,
        requestedBy: ctx.onBehalfOfUserId ?? ctx.userId,
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "lyric.suggestion.created",
      projectId: work.projectId,
      entityType: "lyric_suggestion",
      entityId: row.id,
      after: {
        workId,
        baseVersionNo: base.versionNo,
        kind: row.kind,
        provider: row.provider,
        model: row.model,
        suggestionSha256: sha256Hex(text),
      },
    });
    return { suggestion: row, baseVersionNo: base.versionNo };
  });
}

export async function listSuggestions(exec: Executor, ctx: ServiceContext, workId: string) {
  await getWork(exec, ctx, workId);
  return exec
    .select({
      s: lyricSuggestions,
      baseVersionNo: lyricVersions.versionNo,
      baseBody: lyricVersions.body,
      requestedByName: user.name,
    })
    .from(lyricSuggestions)
    .innerJoin(lyricVersions, eq(lyricVersions.id, lyricSuggestions.baseVersionId))
    .leftJoin(user, eq(user.id, lyricSuggestions.requestedBy))
    .where(and(eq(lyricSuggestions.workId, workId), eq(lyricSuggestions.workspaceId, ctx.workspaceId)))
    .orderBy(desc(lyricSuggestions.createdAt));
}

async function loadOpen(exec: Executor, ctx: ServiceContext, suggestionId: string) {
  const [s] = await exec
    .select()
    .from(lyricSuggestions)
    .where(and(eq(lyricSuggestions.id, suggestionId), eq(lyricSuggestions.workspaceId, ctx.workspaceId)))
    .for("update");
  if (!s) throw notFound("Suggestion not found.");
  const { work } = await requireWorkRole(exec, ctx, s.workId, "editor", { forUpdate: true });
  if (s.status !== "open") throw invalid(`This suggestion was already ${s.status}.`);
  return { s, work };
}

export const acceptInput = z.object({
  /** The text the person is saving; they may edit the suggestion first. */
  body: z.string(),
  changeNote: z.string().trim().max(500).optional().nullable(),
});

/** A person accepts (and possibly edits) a suggestion; it becomes a new version marked as AI-assisted. */
export async function acceptSuggestion(ctx: ServiceContext, suggestionId: string, input: z.input<typeof acceptInput>) {
  const data = acceptInput.parse(input);
  const body = lyricBody.parse(data.body);
  return db.transaction(async (tx) => {
    const { s, work } = await loadOpen(tx, ctx, suggestionId);
    assertDraft(work, "the text");
    const latest = await latestVersion(tx, work.id);
    if (!latest || latest.id !== s.baseVersionId) {
      throw invalid("The lyrics changed after this suggestion was made. Dismiss it and ask for a new one.");
    }
    if (sha256Hex(body) === latest.contentSha256) throw invalid("Nothing changed since the last version.");
    const editedByHuman = body !== s.suggestion;
    const version = await insertVersion(tx, ctx, work, latest, {
      body,
      origin: "human_edit_of_ai_suggestion",
      claimedWrittenAt: null,
      changeNote:
        data.changeNote ||
        `Accepted ${SUGGESTION_KINDS[s.kind].toLowerCase()} suggestion from ${s.provider} (${s.model})${editedByHuman ? ", with edits" : ""}`,
    });
    await tx
      .update(lyricSuggestions)
      .set({ status: "accepted", decidedBy: ctx.userId, decidedAt: new Date(), acceptedVersionId: version.id })
      .where(eq(lyricSuggestions.id, s.id));
    await recordAudit(tx, ctx, {
      action: "lyric.suggestion.accepted",
      projectId: work.projectId,
      entityType: "lyric_suggestion",
      entityId: s.id,
      after: { workId: work.id, versionNo: version.versionNo, versionId: version.id, editedByHuman, provider: s.provider, model: s.model },
    });
    return version;
  });
}

export async function dismissSuggestion(ctx: ServiceContext, suggestionId: string) {
  return db.transaction(async (tx) => {
    const { s, work } = await loadOpen(tx, ctx, suggestionId);
    await tx
      .update(lyricSuggestions)
      .set({ status: "dismissed", decidedBy: ctx.userId, decidedAt: new Date() })
      .where(eq(lyricSuggestions.id, s.id));
    await recordAudit(tx, ctx, {
      action: "lyric.suggestion.dismissed",
      projectId: work.projectId,
      entityType: "lyric_suggestion",
      entityId: s.id,
      after: { workId: work.id },
    });
  });
}
