import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { latestJobRuns, RETENTION } from "@/lib/jobs";
import { notFound } from "next/navigation";
import { hasWorkspaceRole } from "@/lib/services/access";
import { latestSyncRun, spotifyStatus } from "@/lib/services/spotify";

export const metadata: Metadata = { title: "System" };

const JOB_LABEL = {
  "spotify-snapshot": "Spotify snapshot and alerts (daily)",
  "audit-verify": "Audit-chain verification (daily)",
  retention: "Data retention (daily)",
} as const;

export default async function SystemPage() {
  const { ctx } = await requireAppContext();
  if (!hasWorkspaceRole(ctx.workspaceRole, "admin")) notFound();
  const [jobs, lastSync] = await Promise.all([latestJobRuns(), latestSyncRun(db)]);
  const spotify = spotifyStatus();
  const env = [
    ["CRON_SECRET", !!process.env.CRON_SECRET],
    ["SPOTIFY_CLIENT_ID / SECRET", spotify.configured],
    ["RESEND_API_KEY / EMAIL_FROM", !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM],
    ["AUDIT_ALERT_EMAIL", !!process.env.AUDIT_ALERT_EMAIL],
    ["BLOB_READ_WRITE_TOKEN", !!process.env.BLOB_READ_WRITE_TOKEN],
  ] as const;

  return (
    <>
      <PageHeader title="System" description="Scheduled jobs and configuration. Visible to owners and admins." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Scheduled jobs</CardTitle>
            <CardDescription>Run by Vercel Cron (see vercel.json); each call must carry the CRON_SECRET.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map(({ job, run }) => (
                  <TableRow key={job} data-testid="job-row" data-job={job}>
                    <TableCell className="font-medium">{JOB_LABEL[job]}</TableCell>
                    <TableCell>{run ? formatDateTime(run.startedAt) : "Never"}</TableCell>
                    <TableCell className="max-w-md">
                      {!run ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <CircleDashed className="size-4" /> Not run yet
                        </span>
                      ) : run.ok ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="size-4" /> OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <CircleAlert className="size-4" /> Failed
                        </span>
                      )}
                      {run?.detail != null && <pre className="mt-1 truncate text-xs text-muted-foreground">{JSON.stringify(run.detail).slice(0, 200)}</pre>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {lastSync && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last Spotify sync: {formatDateTime(lastSync.startedAt)}, {lastSync.status}, {lastSync.requests} requests, {lastSync.retries} retries
                {lastSync.error ? ` (${lastSync.error.split("\n")[0]})` : ""}.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>Whether each optional setting is present. Values are never shown.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {env.map(([k, ok]) => (
              <div key={k} className="flex items-center gap-2">
                {ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <CircleDashed className="size-4 text-muted-foreground" />}
                <span className="font-mono text-xs">{k}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Retention</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Abandoned import previews are deleted after {RETENTION.previewedImportDays} days, raw Spotify responses after {RETENTION.rawSnapshotDays} days,
            notifications after {RETENTION.notificationDays} days and job history after {RETENTION.jobRunDays} days. Expired sessions are removed daily. Audit
            events, lyric versions, evidence and rights packages are never deleted.
          </CardContent>
        </Card>
      </div>
    </>
  );
}
