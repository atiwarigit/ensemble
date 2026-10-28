import { CheckCircle2, FileCheck2, FileClock, Lock, Pencil, Stamp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PendingApprovalNotice } from "@/components/pending-approval-notice";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { formatDate, formatTimestamp, shortHash } from "@/lib/format";
import {
  EVIDENCE_KINDS,
  getWork,
  listContributors,
  listEvidence,
  listGenerations,
  listVersions,
  STATUS_LABEL,
} from "@/lib/services/lyrics";
import { listApprovals } from "@/lib/services/approvals";
import { listProjectMembers } from "@/lib/services/projects";
import { ContributorsEditor } from "./contributors-editor";
import { DetailsForm } from "./details-form";
import { EvidenceForm } from "./evidence-form";
import { GenerationForm } from "./generation-form";
import { ORIGIN_LABEL } from "./labels";

export const metadata: Metadata = { title: "Lyric" };

export default async function LyricWorkPage(props: PageProps<"/lyrics/[workId]">) {
  const { workId } = await props.params;
  const sp = await props.searchParams;
  const { ctx } = await requireAppContext();
  const { work, project, role } = await orNotFound(getWork(db, ctx, workId));
  const [versions, contributors, evidence, generations, members, pendingApprovals] = await Promise.all([
    listVersions(db, ctx, workId),
    listContributors(db, workId),
    listEvidence(db, workId),
    listGenerations(db, workId),
    listProjectMembers(db, ctx, work.projectId),
    listApprovals(db, ctx, { scope: "pending", entityType: "lyric_work", entityId: workId }),
  ]);
  const pendingFinalize = pendingApprovals.some((r) => r.req.actionType === "lyric.finalize");
  const pendingSplit = pendingApprovals.some((r) => r.req.actionType === "lyric.contributors.change");
  const latest = versions[0]?.version;
  const canEdit = role !== "viewer" && !project.archivedAt;
  const isDraft = work.status === "draft";
  const saved = typeof sp.saved === "string" ? versions.find((v) => String(v.version.versionNo) === sp.saved)?.version : undefined;
  const versionOptions = versions.map(({ version: v }) => ({ id: v.id, label: `v${v.versionNo} · ${formatTimestamp(v.recordedAt)}` }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {work.title}
            <Badge variant={isDraft ? "outline" : "secondary"} data-testid="work-status">
              {STATUS_LABEL[work.status]}
            </Badge>
          </span>
        }
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link href={`/projects/${project.id}`} className="hover:underline">
              {project.name}
            </Link>
            {work.isrc && <span>· ISRC {work.isrc}</span>}
            {work.iswc && <span>· ISWC {work.iswc}</span>}
          </span>
        }
        actions={
          <>
            {latest && (
              <Button variant="outline" asChild>
                <Link href={`/lyrics/${work.id}/rights`}>
                  <FileCheck2 /> Rights package
                </Link>
              </Button>
            )}
            {canEdit && isDraft && latest && (
              <RequestApprovalButton
                actionType="lyric.finalize"
                payload={{ workId: work.id }}
                variant="outline"
                disabled={pendingFinalize}
                title={`Request finalization of “${work.title}”`}
                description="Finalizing locks the text and the split and issues the final rights package. A project lead or workspace owner has to approve it; you can't approve your own request."
              >
                <Stamp /> {pendingFinalize ? "Finalization requested" : "Request finalization"}
              </RequestApprovalButton>
            )}
            {canEdit && isDraft && (
              <Button asChild>
                <Link href={`/lyrics/${work.id}/edit`}>
                  <Pencil /> {latest ? "Edit lyrics" : "Add lyrics"}
                </Link>
              </Button>
            )}
          </>
        }
      />

      <PendingApprovalNotice rows={pendingApprovals} />
      {!isDraft && work.finalizedAt && (
        <Alert data-testid="final-alert">
          <Lock />
          <AlertTitle>Final</AlertTitle>
          <AlertDescription>
            Finalized {formatTimestamp(work.finalizedAt)}. The text and split are locked; split changes need an approval.
          </AlertDescription>
        </Alert>
      )}

      {saved && (
        <Alert data-testid="saved-alert">
          <CheckCircle2 />
          <AlertTitle>Version {saved.versionNo} recorded</AlertTitle>
          <AlertDescription>
            Recorded at {formatTimestamp(saved.recordedAt)} · SHA-256 <code className="font-mono">{saved.contentSha256}</code>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>{latest ? `Current lyrics · v${latest.versionNo}` : "No lyrics yet"}</CardTitle>
            <CardDescription>
              {latest
                ? `Recorded ${formatTimestamp(latest.recordedAt)}`
                : "Add the human-written lyrics before logging any AI generations."}
            </CardDescription>
          </CardHeader>
          {latest && (
            <CardContent>
              <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed" data-testid="current-lyrics">
                {latest.body}
              </pre>
            </CardContent>
          )}
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Contributors</CardTitle>
              <CardDescription>
                {isDraft ? "Splits must add up to 100%." : "Locked. Changing the split on a final work needs an approval."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ContributorsEditor
                workId={work.id}
                mode={!canEdit ? "readonly" : isDraft ? "direct" : "request"}
                hasPendingRequest={pendingSplit}
                initial={contributors.map((c) => ({
                  name: c.name,
                  userId: c.userId,
                  role: c.role,
                  sharePct: c.shareBps / 100,
                  human: c.human,
                }))}
                members={members.map((m) => ({ id: m.userId, name: m.name }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailsForm
                workId={work.id}
                editable={canEdit}
                titleLocked={!isDraft}
                values={{ title: work.title, isrc: work.isrc ?? "", iswc: work.iswc ?? "" }}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileClock className="size-4" /> Version history
          </CardTitle>
          <CardDescription>
            Times come from the database clock when each version was saved. Versions can&apos;t be edited or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No versions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Recorded (UTC)</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Origin</TableHead>
                  <TableHead>SHA-256</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map(({ version: v, authorName }) => (
                  <TableRow key={v.id} data-testid="version-row">
                    <TableCell>
                      <Link href={`/lyrics/${work.id}/versions/${v.versionNo}`} className="font-medium hover:underline">
                        v{v.versionNo}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{formatTimestamp(v.recordedAt)}</TableCell>
                    <TableCell>{authorName ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {ORIGIN_LABEL[v.origin]}
                      {v.claimedWrittenAt && (
                        <span className="block text-muted-foreground">
                          Written {formatDate(v.claimedWrittenAt)} (stated by the author)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs" title={v.contentSha256}>
                      {shortHash(v.contentSha256)}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-xs text-muted-foreground">{v.changeNote ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Evidence</CardTitle>
            <CardDescription>Notebook photos, voice memos, drafts and emails. Each file is fingerprinted when it&apos;s attached.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {evidence.length > 0 && (
              <ul className="grid gap-2" data-testid="evidence-list">
                {evidence.map(({ evidence: e, uploadedByName, versionNo }) => (
                  <li key={e.id} className="rounded-md border p-3 text-sm" data-testid="evidence-item">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <a href={`/api/lyrics/evidence/${e.id}`} className="font-medium hover:underline">
                        {e.filename}
                      </a>
                      <Badge variant="outline">{EVIDENCE_KINDS[e.kind]}</Badge>
                    </div>
                    {e.description && <p className="mt-1 text-muted-foreground">{e.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {uploadedByName} · {formatTimestamp(e.uploadedAt)}
                      {versionNo && ` · for v${versionNo}`} · {(e.sizeBytes / 1024).toFixed(0)} KB
                    </p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground" title={e.sha256}>
                      SHA-256 {shortHash(e.sha256)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <EvidenceForm workId={work.id} versions={versionOptions} />
            ) : (
              evidence.length === 0 && <p className="text-sm text-muted-foreground">No evidence attached.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI generation log</CardTitle>
            <CardDescription>
              Record each time these lyrics were used with a generation tool. Every entry points at the human-written version it used.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {generations.length > 0 && (
              <ul className="grid gap-2" data-testid="generation-list">
                {generations.map(({ link: g, versionNo, loggedByName }) => (
                  <li key={g.id} className="rounded-md border p-3 text-sm" data-testid="generation-item">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{g.tool}</span>
                      <Badge variant="outline">Used v{versionNo}</Badge>
                    </div>
                    {g.externalRef && <p className="mt-1 break-all text-xs">{g.externalRef}</p>}
                    {g.notes && <p className="mt-1 text-muted-foreground">{g.notes}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {loggedByName} · {formatTimestamp(g.loggedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {canEdit ? (
              <GenerationForm workId={work.id} versions={versionOptions} />
            ) : (
              generations.length === 0 && <p className="text-sm text-muted-foreground">No generations logged.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
