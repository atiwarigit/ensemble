"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { runAction } from "@/lib/authz";
import { evaluateAlerts, markNotificationsRead, updateAlertRule } from "@/lib/services/alerts";
import { recordAudit } from "@/lib/services/audit";
import { requireProjectRole } from "@/lib/services/access";
import { commitS4aImport, createS4aImport, discardS4aImport, updateS4aConfig } from "@/lib/services/s4a";
import { resolveArtistInput, runSpotifySnapshot } from "@/lib/services/spotify";
import { S4A_METRICS } from "@/lib/csv/s4a-csv";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

export async function resolveArtistAction(projectId: string, input: string) {
  return runAction(({ ctx }) => resolveArtistInput(ctx, projectId, input));
}

export async function runSnapshotAction(projectId: string) {
  const result = await runAction(async ({ ctx }) => {
    await requireProjectRole(db, ctx, projectId, "lead");
    const r = await runSpotifySnapshot({ trigger: "manual", projectId });
    await recordAudit(db, ctx, {
      action: "spotify.snapshot.manual",
      projectId,
      entityType: "spotify_sync_run",
      entityId: r.runId,
      after: { status: r.status, artists: r.artists, tracks: r.tracks, fields: r.fields, errors: r.errors.slice(0, 5) },
    });
    const alerts = await evaluateAlerts({ projectIds: [projectId] });
    return { ...r, alerts };
  });
  revalidatePath(`/analytics/${projectId}`);
  if (!result.ok) return result;
  const r = result.data!;
  if (r.status === "skipped") return { ok: false as const, error: r.errors[0] ?? "Nothing to snapshot: link an artist first." };
  if (r.status === "error") return { ok: false as const, error: `Spotify snapshot failed: ${r.errors[0]}` };
  const fields = r.fields.popularity || r.fields.followers ? "" : " Spotify didn't include followers or popularity.";
  return {
    ...result,
    message: `Snapshot saved: ${r.tracks} tracks for ${r.artists} artist${r.artists === 1 ? "" : "s"}.${fields}${r.alerts ? ` ${r.alerts} new alert${r.alerts === 1 ? "" : "s"}.` : ""}`,
  };
}

export type UploadState = { error?: string } | undefined;

export async function uploadS4aAction(projectId: string, _prev: UploadState, form: FormData): Promise<UploadState> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a Spotify for Artists CSV export." };
  const result = await runAction(async ({ ctx }) =>
    createS4aImport(ctx, { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()), projectId }),
  );
  if (!result.ok) return { error: result.error };
  redirect(`/analytics/${projectId}/import/${result.data!.id}`);
}

export async function updateS4aConfigAction(projectId: string, batchId: string, form: FormData) {
  const result = await runAction(
    ({ ctx }) =>
      updateS4aConfig(ctx, batchId, {
        dateColumn: str(form, "dateColumn"),
        dateFormat: str(form, "dateFormat") as never,
        fixedDate: str(form, "fixedDate"),
        trackColumn: str(form, "trackColumn"),
        fixedTrackId: str(form, "fixedTrackId"),
        metrics: Object.fromEntries(S4A_METRICS.map((m) => [m, str(form, `metric_${m}`)])) as never,
      }),
    "Mapping updated.",
  );
  revalidatePath(`/analytics/${projectId}/import/${batchId}`);
  return result;
}

export async function commitS4aAction(projectId: string, batchId: string) {
  const result = await runAction(async ({ ctx }) => {
    const b = await commitS4aImport(ctx, batchId);
    const alerts = await evaluateAlerts({ projectIds: [projectId] });
    return { inserted: b.inserted, skipped: b.skippedDupes, alerts };
  });
  revalidatePath(`/analytics/${projectId}`, "layout");
  revalidatePath("/", "layout");
  return result;
}

export async function discardS4aAction(projectId: string, batchId: string) {
  const result = await runAction(({ ctx }) => discardS4aImport(ctx, batchId));
  if (!result.ok) return result;
  revalidatePath(`/analytics/${projectId}`);
  redirect(`/analytics/${projectId}`);
}

export async function updateAlertRuleAction(projectId: string, ruleId: string, input: { enabled: boolean; threshold?: number; days?: number; step?: number }) {
  const result = await runAction(async ({ ctx }) => {
    await updateAlertRule(ctx, ruleId, input);
    return { alerts: await evaluateAlerts({ projectIds: [projectId] }) };
  }, "Alert saved.");
  revalidatePath(`/analytics/${projectId}`);
  revalidatePath("/", "layout");
  return result;
}

export async function markReadAction(ids: string[] | "all") {
  const result = await runAction(({ ctx }) => markNotificationsRead(ctx, ids));
  revalidatePath("/", "layout");
  return result;
}
