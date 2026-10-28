import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { jobRuns, notifications, rateLimits, spotifySnapshots, spotifySyncRuns } from "@/db/schema/analytics";
import { session, user, verification } from "@/db/schema/auth";
import { importBatches } from "@/db/schema/expenses";
import { workspaceMembers, workspaces } from "@/db/schema/tenancy";
import { sendAlertEmail } from "@/lib/email";
import { evaluateAlerts, notifyWorkspace } from "@/lib/services/alerts";
import { expireStale } from "@/lib/services/approvals";
import { recordSystemAudit, verifyAuditChain } from "@/lib/services/audit";
import { runSpotifySnapshot } from "@/lib/services/spotify";

export type JobName = "spotify-snapshot" | "audit-verify" | "retention";

export const RETENTION = {
  rateLimitDays: 1,
  previewedImportDays: 7,
  rawSnapshotDays: 90,
  syncRunDays: 180,
  notificationDays: 180,
  jobRunDays: 90,
};

async function recordJob<T extends Record<string, unknown>>(job: JobName, fn: () => Promise<T & { ok: boolean }>) {
  const [run] = await db.insert(jobRuns).values({ job, ok: false }).returning();
  try {
    const result = await fn();
    await db.update(jobRuns).set({ ok: result.ok, detail: result, finishedAt: new Date() }).where(eq(jobRuns.id, run.id));
    return result;
  } catch (err) {
    await db
      .update(jobRuns)
      .set({ ok: false, detail: { error: (err as Error).message }, finishedAt: new Date() })
      .where(eq(jobRuns.id, run.id));
    throw err;
  }
}

export function runSpotifyJob(opts: { now?: Date; sleep?: (ms: number) => Promise<void> } = {}) {
  return recordJob("spotify-snapshot", async () => {
    const snapshot = await runSpotifySnapshot({ trigger: "cron", ...opts });
    // Stale-export alerts depend on the date, so every project is evaluated, not just the snapshotted ones.
    const alerts = await evaluateAlerts({ now: opts.now });
    return { ok: snapshot.status !== "error", ...snapshot, alerts };
  });
}

/**
 * Re-verifies the whole audit hash chain. On a break, owners and admins get an in-app notice and
 * owners plus AUDIT_ALERT_EMAIL are emailed (once per first broken event).
 */
export function runAuditVerifyJob() {
  return recordJob("audit-verify", async () => {
    const chain = await verifyAuditChain(db);
    let emailed = 0;
    if (!chain.ok) {
      const first = chain.breaks[0];
      const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
      let fresh = false;
      for (const w of allWorkspaces) {
        const n = await notifyWorkspace(db, w.id, {
          kind: "audit_chain_break",
          title: "The audit log failed verification",
          body: `Event #${first.id}: ${first.reason}. ${chain.breaks.length} problem(s) found. See docs/security-review.md for what to do.`,
          href: "/audit",
          dedupeKey: `audit-break:${first.id}`,
          data: chain,
        });
        if (n) fresh = true;
      }
      if (fresh) {
        const owners = await db
          .select({ email: user.email })
          .from(workspaceMembers)
          .innerJoin(user, eq(user.id, workspaceMembers.userId))
          .where(eq(workspaceMembers.role, "owner"));
        emailed = await sendAlertEmail({
          to: [...owners.map((o) => o.email), ...(process.env.AUDIT_ALERT_EMAIL ?? "").split(",").map((s) => s.trim())],
          subject: "Ensemble: the audit log failed verification",
          text: `The nightly check found ${chain.breaks.length} problem(s) in the audit hash chain, starting at event #${first.id} (${first.reason}).\n\nNo data has been changed by this check. Follow the incident steps in docs/security-review.md.`,
        });
      }
      await recordSystemAudit(db, {}, { action: "audit.chain.broken", entityType: "audit_event", entityId: String(first.id), after: { breaks: chain.breaks.slice(0, 20) } });
    }
    return { ok: chain.ok, count: chain.count, headId: chain.head?.id ?? null, breaks: chain.breaks.slice(0, 20), emailed };
  });
}

type RetentionCount =
  | "rateLimitWindows"
  | "expiredSessions"
  | "expiredVerifications"
  | "abandonedImports"
  | "snapshotRawCleared"
  | "syncRuns"
  | "notifications"
  | "jobRuns"
  | "approvalsExpired";

const daysAgo = (n: number, now: Date) => new Date(now.getTime() - n * 86_400_000);

/** Deletes data the app no longer needs. Audit events are never deleted (the chain must stay whole). */
export function runRetentionJob(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return recordJob("retention", async () => {
    const counts: Record<string, number> = {};
    const n = async (key: string, q: Promise<unknown[]>) => {
      counts[key] = (await q).length;
    };
    await n("rateLimitWindows", db.delete(rateLimits).where(lt(rateLimits.windowStart, daysAgo(RETENTION.rateLimitDays, now))).returning({ k: rateLimits.key }));
    await n("expiredSessions", db.delete(session).where(lt(session.expiresAt, now)).returning({ id: session.id }));
    await n("expiredVerifications", db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id }));

    // Uploaded-but-never-committed imports still hold the whole CSV.
    const stale = await db
      .delete(importBatches)
      .where(and(eq(importBatches.status, "previewed"), lt(importBatches.createdAt, daysAgo(RETENTION.previewedImportDays, now))))
      .returning({ id: importBatches.id, workspaceId: importBatches.workspaceId, projectId: importBatches.projectId, filename: importBatches.filename, kind: importBatches.kind });
    counts.abandonedImports = stale.length;
    for (const b of stale) {
      await recordSystemAudit(db, { workspaceId: b.workspaceId }, {
        action: "import.expired",
        projectId: b.projectId,
        entityType: "import_batch",
        entityId: b.id,
        before: { filename: b.filename, kind: b.kind },
      });
    }

    await n(
      "snapshotRawCleared",
      db
        .update(spotifySnapshots)
        .set({ raw: null })
        .where(and(isNotNull(spotifySnapshots.raw), lt(spotifySnapshots.capturedOn, daysAgo(RETENTION.rawSnapshotDays, now).toISOString().slice(0, 10))))
        .returning({ id: spotifySnapshots.id }),
    );
    await n("syncRuns", db.delete(spotifySyncRuns).where(lt(spotifySyncRuns.startedAt, daysAgo(RETENTION.syncRunDays, now))).returning({ id: spotifySyncRuns.id }));
    await n("notifications", db.delete(notifications).where(lt(notifications.createdAt, daysAgo(RETENTION.notificationDays, now))).returning({ id: notifications.id }));
    await n("jobRuns", db.delete(jobRuns).where(and(lt(jobRuns.startedAt, daysAgo(RETENTION.jobRunDays, now)), isNotNull(jobRuns.finishedAt))).returning({ id: jobRuns.id }));
    let approvalsExpired = 0;
    for (const w of await db.select({ id: workspaces.id }).from(workspaces)) approvalsExpired += await expireStale(db, w.id);
    counts.approvalsExpired = approvalsExpired;
    return { ok: true, ...(counts as Record<RetentionCount, number>) };
  });
}

export async function latestJobRuns() {
  const jobs: JobName[] = ["spotify-snapshot", "audit-verify", "retention"];
  const rows = await db
    .selectDistinctOn([jobRuns.job])
    .from(jobRuns)
    .where(inArray(jobRuns.job, jobs))
    .orderBy(jobRuns.job, desc(jobRuns.startedAt));
  return jobs.map((job) => ({ job, run: rows.find((r) => r.job === job) ?? null }));
}
