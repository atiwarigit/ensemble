import { Download, ShieldCheck, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { formatTimestamp } from "@/lib/format";
import { ServiceError } from "@/lib/services/context";
import { EVIDENCE_KINDS, getWork, STATUS_LABEL } from "@/lib/services/lyrics";
import { buildManifest, listPackages } from "@/lib/services/rights";
import { ORIGIN_LABEL, ROLE_LABEL } from "../labels";
import { DraftPackageButton } from "./draft-package-button";

export const metadata: Metadata = { title: "Rights package" };

export default async function RightsPage(props: PageProps<"/lyrics/[workId]/rights">) {
  const { workId } = await props.params;
  const { ctx } = await requireAppContext();
  const { work, role } = await orNotFound(getWork(db, ctx, workId));
  const [packages, m] = await Promise.all([
    listPackages(db, ctx, workId),
    buildManifest(db, ctx, work, { packageId: "preview", kind: work.status === "draft" ? "draft" : "final" }).catch((err) => {
      if (err instanceof ServiceError && err.code === "invalid") return null;
      throw err;
    }),
  ]);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`Rights package · ${work.title}`}
        description="What a package contains, generated from the authorship record. The PDF and ZIP carry the same sections and hashes."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/lyrics/${work.id}`}>Back to lyric</Link>
            </Button>
            {role !== "viewer" && m && <DraftPackageButton workId={work.id} />}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Generated packages</CardTitle>
          <CardDescription>
            {work.status === "draft"
              ? "The final package is issued when finalization is approved. Draft packages are marked DRAFT and are for review only."
              : `Final since ${work.finalizedAt ? formatTimestamp(work.finalizedAt) : "—"}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {packages.length === 0 ? (
            <p className="text-sm text-muted-foreground">No packages yet.</p>
          ) : (
            packages.map(({ pkg, createdByName }) => (
              <div key={pkg.id} className="rounded-md border p-3" data-testid="rights-package">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={pkg.kind === "final" ? "default" : "outline"}>{pkg.kind === "final" ? "Final" : "Draft"}</Badge>
                    <span className="text-sm">
                      {formatTimestamp(pkg.createdAt)} · {createdByName} · {(pkg.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`/api/rights/packages/${pkg.id}`} data-testid="package-download">
                      <Download /> Download ZIP
                    </a>
                  </Button>
                </div>
                <p className="mt-2 font-mono text-xs break-all text-muted-foreground">ZIP SHA-256 {pkg.zipSha256}</p>
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-muted-foreground">SHA256SUMS</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono" data-testid="sha256sums">
                    {pkg.sha256sums}
                  </pre>
                </details>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {!m ? (
        <p className="text-sm text-muted-foreground">Add the lyrics to see a package preview.</p>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>1. Work</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>
                {m.work.title} · {m.project.name}
                {m.project.artistName && ` · ${m.project.artistName}`} · {STATUS_LABEL[work.status]}
              </p>
              <p className="text-muted-foreground">
                ISRC {m.work.isrc ?? "not assigned"} · ISWC {m.work.iswc ?? "not assigned"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>2. Contributors and splits</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Share</TableHead>
                    <TableHead>Human / AI</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.contributors.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell>{c.name}</TableCell>
                      <TableCell>{ROLE_LABEL[c.role]}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.sharePct}%</TableCell>
                      <TableCell>{c.human ? "Human" : "Not human"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>3. Authorship timeline</CardTitle>
              <CardDescription>Each version&apos;s hash also appears in the audit event that recorded it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Version</TableHead>
                    <TableHead>Recorded (UTC)</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Origin</TableHead>
                    <TableHead>Text SHA-256</TableHead>
                    <TableHead>Audit event</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.versions.map((v) => (
                    <TableRow key={v.id} data-testid="timeline-row">
                      <TableCell>v{v.versionNo}</TableCell>
                      <TableCell className="font-mono text-xs">{formatTimestamp(v.recordedAt)}</TableCell>
                      <TableCell>{v.author}</TableCell>
                      <TableCell className="text-xs">
                        {ORIGIN_LABEL[v.origin]}
                        {v.authorStatedWrittenAt && <span className="block text-muted-foreground">Written {v.authorStatedWrittenAt} (stated by the author)</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs break-all">{v.contentSha256}</TableCell>
                      <TableCell className="font-mono text-xs" title={v.auditEventHash ?? undefined}>
                        #{v.auditEventId}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>4. Evidence</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {m.evidence.length === 0 && <p className="text-muted-foreground">No evidence attached.</p>}
                {m.evidence.map((e) => (
                  <div key={e.id}>
                    {e.filename} · {EVIDENCE_KINDS[e.kind]}
                    <p className="font-mono text-xs break-all text-muted-foreground">{e.sha256}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>5. AI generation log</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm">
                {m.generations.length === 0 && <p className="text-muted-foreground">No generations logged.</p>}
                {m.generations.map((g, i) => (
                  <div key={i}>
                    {g.tool} used lyric v{g.versionNo} · {formatTimestamp(g.loggedAt)}
                    {g.externalRef && <p className="text-xs break-all text-muted-foreground">{g.externalRef}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>6. Human and AI contributions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <p>{m.statement.human}</p>
              <p>{m.statement.ai}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                7. Audit excerpt
                {m.audit.chainVerified ? (
                  <Badge variant="secondary">
                    <ShieldCheck /> Chain verified
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <ShieldX /> Chain break
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Chain head #{m.audit.chainHead?.id} <code className="font-mono break-all">{m.audit.chainHead?.hash}</code>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.audit.events.map((e) => (
                    <TableRow key={e.id} data-testid="excerpt-row">
                      <TableCell className="font-mono text-xs">{e.id}</TableCell>
                      <TableCell className="font-mono text-xs">{formatTimestamp(e.at)}</TableCell>
                      <TableCell className="font-mono text-xs">{e.action}</TableCell>
                      <TableCell className="font-mono text-xs break-all">{e.hash}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">{m.limitation}</p>
        </>
      )}
    </div>
  );
}
