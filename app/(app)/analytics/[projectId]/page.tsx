import { ArrowLeft, Bell, FileSpreadsheet, Info, Music2, Unlink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { PendingApprovalNotice } from "@/components/pending-approval-notice";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { S4A_METRIC_LABEL, type S4aMetric } from "@/lib/csv/s4a-csv";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasProjectRole } from "@/lib/services/access";
import { ALERT_KINDS, dailyStreams, listAlertRules, listNotifications } from "@/lib/services/alerts";
import { compareTracks, dayMinus, getTrends, latestTracksWithWorks, SOURCE } from "@/lib/services/analytics";
import { listApprovals } from "@/lib/services/approvals";
import { getProject } from "@/lib/services/projects";
import { listS4aImports, s4aSeries } from "@/lib/services/s4a";
import { artistSeries, latestSyncRun, listArtistLinks, listTracks, spotifyStatus } from "@/lib/services/spotify";
import { SeriesChart } from "../series-chart";
import { AlertRules, type RuleView } from "./alert-rules";
import { LinkArtistForm } from "./link-artist-form";
import { S4aUploadForm } from "./s4a-upload-form";
import { SnapshotButton } from "./snapshot-button";

export const metadata: Metadata = { title: "Analytics" };

const num = (n: number) => Math.round(n).toLocaleString("en-US");

function SourceLine({ source, asOf }: { source: string; asOf: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="source-label">
      <Badge variant="outline" className="font-normal">
        {source}
      </Badge>
      {asOf ? `as of ${formatDate(asOf)}` : "no data yet"}
    </span>
  );
}

function Kpi({ label, value, change, hint }: { label: string; value: string; change: number | null | undefined; hint?: string }) {
  return (
    <div className="rounded-md border p-3" data-testid="kpi">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">
        {change === null || change === undefined ? (hint ?? "no earlier period to compare") : `${change >= 0 ? "+" : ""}${change}% vs previous period`}
      </div>
    </div>
  );
}

export default async function ProjectAnalyticsPage(props: PageProps<"/analytics/[projectId]">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  const { project, role } = await orNotFound(getProject(db, ctx, projectId));
  const isLead = hasProjectRole(role, "lead");
  const canImport = hasProjectRole(role, "editor") && !project.archivedAt;
  const since = dayMinus(new Date().toISOString().slice(0, 10), 120);

  const [links, trends, streams, listeners, snaps, tracks, compare, works, imports, rules, notes, pendingLink, pendingUnlink, lastRun] = await Promise.all([
    listArtistLinks(db, ctx, projectId),
    getTrends(db, ctx, projectId, 28),
    dailyStreams(db, projectId),
    s4aSeries(db, ctx, projectId, { metric: "listeners", from: since }),
    artistSeries(db, ctx, projectId, 120),
    listTracks(db, ctx, projectId),
    compareTracks(db, ctx, projectId, { days: 28 }),
    latestTracksWithWorks(db, ctx, projectId),
    listS4aImports(db, ctx, projectId),
    listAlertRules(db, ctx, projectId),
    listNotifications(db, ctx, { limit: 100 }),
    listApprovals(db, ctx, { scope: "pending", entityType: "project", entityId: projectId }),
    listApprovals(db, ctx, { scope: "pending", entityType: "spotify_artist" }),
    latestSyncRun(db),
  ]);
  const status = spotifyStatus();
  const linkRequests = pendingLink.filter((r) => r.req.actionType === "spotify.connect");
  const unlinkRequests = pendingUnlink.filter((r) => r.req.projectId === projectId);
  const projectNotes = notes.filter((n) => n.n.projectId === projectId).slice(0, 8);

  const byDate = new Map<string, Record<string, string | number | null>>();
  const put = (date: string, k: string, v: number | null) => byDate.set(date, { ...(byDate.get(date) ?? { date }), [k]: v });
  streams.filter((s) => s.date >= since).forEach((s) => put(s.date, "streams", s.value));
  listeners.forEach((s) => put(s.date, "listeners", s.value));
  const s4aChart = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const webApiChart = snaps.map((s) => ({ date: s.day, followers: s.followers, popularity: s.popularity }));
  const hasFollowers = snaps.some((s) => s.followers != null);
  const hasPopularity = snaps.some((s) => s.popularity != null);
  const releases = [...new Map(tracks.map((t) => [`${t.albumName}|${t.releaseDate}`, t])).values()]
    .filter((t) => t.releaseDate && t.releaseDate >= since)
    .map((t) => ({ date: t.releaseDate!, label: `“${t.albumName}” released` }));
  const workByTrack = new Map(works.map((w) => [w.trackId, w]));
  const streamsByTrack = new Map(compare.rows.map((r) => [r.trackKey, r]));

  const ruleViews: RuleView[] = rules.map((r) => {
    const meta = ALERT_KINDS[r.kind];
    const webApiOnly = r.kind === "popularity_change" || r.kind === "follower_milestone";
    const missing = r.kind === "popularity_change" ? !hasPopularity : r.kind === "follower_milestone" ? !hasFollowers : false;
    return {
      id: r.id,
      kind: r.kind,
      label: meta.label,
      source: meta.source,
      description: meta.describe(r.params),
      enabled: r.enabled,
      params: r.params,
      fields: Object.keys(meta.defaults) as RuleView["fields"],
      lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
      unavailable: webApiOnly && missing && snaps.length ? "Spotify doesn't share this with the app yet (Development Mode), so this alert can't fire." : null,
    };
  });

  const m = trends.s4a?.metrics ?? {};
  const kpi = (k: S4aMetric, label: string) => {
    const w = m[k];
    return <Kpi key={k} label={label} value={w ? num(w.current) : "—"} change={w?.change} hint={w ? undefined : "no data"} />;
  };

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {project.name} <span className="font-normal text-muted-foreground">analytics</span>
          </span>
        }
        description={
          <Link href="/analytics" className="inline-flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All projects
          </Link>
        }
        actions={isLead && links.length > 0 && status.configured ? <SnapshotButton projectId={projectId} /> : undefined}
      />
      <div className="grid gap-6">
        <PendingApprovalNotice rows={[...linkRequests, ...unlinkRequests]} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Streams and listeners
            </CardTitle>
            <CardDescription>
              <SourceLine source={SOURCE.s4a} asOf={trends.s4a?.asOf ?? null} />
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {s4aChart.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground" data-testid="s4a-empty">
                <FileSpreadsheet className="size-8" />
                <p className="max-w-md">
                  Spotify only gives streams and listeners to the artist team, in Spotify for Artists. Export the audience timeline there (Audience → Timeline →
                  download) and import it below.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {kpi("streams", "Streams, last 28 days")}
                  {kpi("listeners", "Listeners per day, last 28 days")}
                  {kpi("saves", "Saves, last 28 days")}
                  {kpi("followers", "Followers (Spotify for Artists)")}
                </div>
                <SeriesChart
                  data={s4aChart}
                  series={[
                    { key: "streams", label: "Streams" },
                    ...(listeners.length ? [{ key: "listeners", label: "Listeners", axis: "right" as const }] : []),
                  ]}
                  markers={releases}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spotify artist</CardTitle>
            <CardDescription>
              <SourceLine source={SOURCE.webApi} asOf={trends.webApi?.asOf ?? null} />
              {lastRun && <span className="ml-2 text-xs">Last run {formatDateTime(lastRun.startedAt)}: {lastRun.status}</span>}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {!status.configured && (
              <Alert>
                <Info />
                <AlertTitle>The daily snapshot is off</AlertTitle>
                <AlertDescription>SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET aren&apos;t set on this deployment.</AlertDescription>
              </Alert>
            )}
            {links.length > 0 ? (
              <div className="grid gap-2">
                {links.map(({ link, linkedByName }) => (
                  <div key={link.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3" data-testid="linked-artist">
                    <Music2 className="size-5 text-muted-foreground" />
                    <div className="flex-1">
                      <div className="font-medium">{link.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Linked by {linkedByName ?? "someone"} on {formatDate(link.linkedAt)} · ID {link.spotifyArtistId}
                      </div>
                    </div>
                    {isLead && (
                      <RequestApprovalButton
                        actionType="spotify.disconnect"
                        payload={{ artistLinkId: link.id }}
                        variant="ghost"
                        size="sm"
                        disabled={unlinkRequests.some((r) => r.req.entityId === link.id)}
                        title={`Unlink ${link.name}`}
                        description="The daily snapshot stops for this artist. Everything captured so far is kept. A workspace owner has to approve."
                      >
                        <Unlink /> Unlink
                      </RequestApprovalButton>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No Spotify artist is linked to this project.</p>
            )}
            {isLead && !project.archivedAt && links.length < 3 && (
              <LinkArtistForm projectId={projectId} projectName={project.name} hasPendingRequest={linkRequests.length > 0} />
            )}

            {snaps.length > 0 &&
              (hasFollowers || hasPopularity ? (
                <SeriesChart
                  data={webApiChart}
                  series={[
                    ...(hasFollowers ? [{ key: "followers", label: "Followers" }] : []),
                    ...(hasPopularity ? [{ key: "popularity", label: "Popularity (0–100)", axis: "right" as const }] : []),
                  ]}
                  markers={releases}
                />
              ) : (
                <Alert data-testid="dev-mode-notice">
                  <Info />
                  <AlertTitle>Spotify doesn&apos;t share followers or popularity with this app</AlertTitle>
                  <AlertDescription>
                    Apps in Spotify&apos;s Development Mode get the catalogue (releases, tracks and ISRCs) but not follower counts or popularity. They appear here
                    automatically if Spotify grants the app extended access. Followers are also in the Spotify for Artists export.
                  </AlertDescription>
                </Alert>
              ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Songs</CardTitle>
            <CardDescription>
              Catalogue from the daily snapshot; streams from Spotify for Artists{compare.asOf ? ` (28 days to ${formatDate(compare.asOf)})` : ""}. Songs are matched to lyrics by ISRC.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {links.length ? "The catalogue appears after the first snapshot." : "Link a Spotify artist to list its songs."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Song</TableHead>
                    <TableHead>Release</TableHead>
                    <TableHead>ISRC</TableHead>
                    <TableHead className="text-right">Streams (28 days)</TableHead>
                    {hasPopularity && <TableHead className="text-right">Popularity</TableHead>}
                    <TableHead>Lyric</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tracks.map((t) => {
                    const s = streamsByTrack.get(`t:${t.id}`);
                    const w = workByTrack.get(t.id);
                    return (
                      <TableRow key={t.id} data-testid="track-row">
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {t.albumName} · {t.releaseDate}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{t.isrc ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s ? num(s.total) : "—"}
                          {s?.change != null && <span className="ml-1 text-xs text-muted-foreground">({s.change >= 0 ? "+" : ""}{s.change}%)</span>}
                        </TableCell>
                        {hasPopularity && <TableCell className="text-right tabular-nums">{t.popularity ?? "—"}</TableCell>}
                        <TableCell>
                          {w ? (
                            <Link href={`/lyrics/${w.workId}`} className="hover:underline">
                              {w.workTitle}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spotify for Artists imports</CardTitle>
            <CardDescription>
              Exports from artists.spotify.com: the audience timeline (date, listeners, streams, followers), a song&apos;s timeline, or the Songs list. Days
              already imported are skipped.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {canImport && <S4aUploadForm projectId={projectId} />}
            {imports.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Data points</TableHead>
                    <TableHead>Uploaded</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map(({ batch, createdByName }) => (
                    <TableRow key={batch.id} data-testid="s4a-import">
                      <TableCell>
                        <Link href={`/analytics/${projectId}/import/${batch.id}`} className="font-medium hover:underline">
                          {batch.filename}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={batch.status === "committed" ? "secondary" : batch.status === "reverted" ? "destructive" : "outline"} className="capitalize">
                          {batch.status === "previewed" ? "Preview" : batch.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {batch.status === "previewed" ? "—" : `${num(batch.inserted)} added, ${num(batch.skippedDupes)} already there`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(batch.createdAt)} by {createdByName ?? "someone"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="size-4" /> Alerts
            </CardTitle>
            <CardDescription>Checked after every snapshot and import. Everyone on the project sees them under Notifications.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {ruleViews.length ? (
              <AlertRules projectId={projectId} rules={ruleViews} canEdit={isLead} />
            ) : (
              <p className="text-sm text-muted-foreground">Alerts are set up when a Spotify artist is linked.</p>
            )}
            {projectNotes.length > 0 && (
              <div className="grid gap-2">
                <h3 className="text-sm font-medium">Recent</h3>
                {projectNotes.map(({ n }) => (
                  <div key={n.id} className="rounded-md border p-3 text-sm" data-testid="project-notification">
                    <div className="font-medium">{n.title}</div>
                    <div className="text-muted-foreground">{n.body}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Metrics: {Object.values(S4A_METRIC_LABEL).join(", ")} come from Spotify for Artists; the catalogue comes from the Spotify Web API. Nothing here is
          scraped.
        </p>
      </div>
    </>
  );
}
