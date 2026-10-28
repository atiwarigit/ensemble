import { diffLines } from "diff";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { formatDate, formatTimestamp } from "@/lib/format";
import { getWork, listVersions } from "@/lib/services/lyrics";
import { cn } from "@/lib/utils";
import { ORIGIN_LABEL } from "../../labels";

export const metadata: Metadata = { title: "Lyric version" };

export default async function LyricVersionPage(props: PageProps<"/lyrics/[workId]/versions/[versionNo]">) {
  const { workId, versionNo } = await props.params;
  const sp = await props.searchParams;
  const { ctx } = await requireAppContext();
  const { work } = await orNotFound(getWork(db, ctx, workId));
  const versions = await listVersions(db, ctx, workId);
  const byNo = new Map(versions.map((v) => [v.version.versionNo, v]));
  const current = byNo.get(Number(versionNo));
  if (!current) notFound();
  const v = current.version;
  const compareNo = typeof sp.compare === "string" ? Number(sp.compare) : v.versionNo - 1;
  const base = compareNo !== v.versionNo ? byNo.get(compareNo)?.version : undefined;
  const parts = base ? diffLines(`${base.body}\n`, `${v.body}\n`) : [];
  const others = versions.filter((x) => x.version.versionNo !== v.versionNo);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`${work.title} · v${v.versionNo}`}
        description={`Recorded ${formatTimestamp(v.recordedAt)} by ${current.authorName ?? "unknown"}`}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/lyrics/${work.id}`}>Back to lyric</Link>
          </Button>
        }
      />
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">SHA-256</dt>
        <dd className="font-mono text-xs break-all" data-testid="version-hash">
          {v.contentSha256}
        </dd>
        <dt className="text-muted-foreground">Origin</dt>
        <dd>{ORIGIN_LABEL[v.origin]}</dd>
        {v.claimedWrittenAt && (
          <>
            <dt className="text-muted-foreground">Date written</dt>
            <dd>{formatDate(v.claimedWrittenAt)} (stated by the author, not verified)</dd>
          </>
        )}
        {v.changeNote && (
          <>
            <dt className="text-muted-foreground">Note</dt>
            <dd>{v.changeNote}</dd>
          </>
        )}
      </dl>

      {others.length > 0 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Compare with">
          <span className="text-muted-foreground">Compare with</span>
          {others.map(({ version: o }) => (
            <Link
              key={o.id}
              href={`/lyrics/${work.id}/versions/${v.versionNo}?compare=${o.versionNo}`}
              className={cn("rounded-md border px-2 py-0.5", o.versionNo === base?.versionNo && "border-primary bg-muted font-medium")}
            >
              v{o.versionNo}
            </Link>
          ))}
        </nav>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {base ? (
              <>
                Changes from v{base.versionNo} <Badge variant="outline">v{base.versionNo} → v{v.versionNo}</Badge>
              </>
            ) : (
              "Text"
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {base ? (
            <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap" data-testid="diff">
              {parts.map((p, i) => (
                <span
                  key={i}
                  data-change={p.added ? "added" : p.removed ? "removed" : undefined}
                  className={cn(
                    "block border-l-2 pl-2",
                    p.added && "border-emerald-500 bg-emerald-500/10",
                    p.removed && "border-red-500 bg-red-500/10 text-muted-foreground line-through",
                    !p.added && !p.removed && "border-transparent",
                  )}
                >
                  {p.value.replace(/\n$/, "")}
                </span>
              ))}
            </pre>
          ) : (
            <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap">{v.body}</pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
