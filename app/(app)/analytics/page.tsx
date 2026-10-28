import { BarChart3, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDate, formatDateTime } from "@/lib/format";
import { analyticsProjects } from "@/lib/services/analytics";
import { latestSyncRun, spotifyStatus } from "@/lib/services/spotify";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const { ctx } = await requireAppContext();
  const [projects, lastRun] = await Promise.all([analyticsProjects(db, ctx), latestSyncRun(db)]);
  const status = spotifyStatus();

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Streams and listeners from Spotify for Artists exports, plus a daily Spotify snapshot of each linked artist's catalogue."
      />
      <div className="grid gap-6">
        {!status.configured && (
          <Alert>
            <CircleAlert />
            <AlertTitle>Spotify isn&apos;t connected</AlertTitle>
            <AlertDescription>
              Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to turn on the daily snapshot. Spotify for Artists CSV imports work without them.
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Projects</CardTitle>
            <CardDescription>
              Daily snapshot:{" "}
              {lastRun ? (
                <>
                  last run {formatDateTime(lastRun.startedAt)} ({lastRun.status}
                  {lastRun.status !== "skipped" ? `, ${lastRun.tracks} tracks` : ""})
                </>
              ) : (
                "hasn't run yet"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                <BarChart3 className="size-8" />
                <p>You aren&apos;t on any projects yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Spotify artist</TableHead>
                    <TableHead>Snapshot as of</TableHead>
                    <TableHead>Spotify for Artists data as of</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projects.map((p) => (
                    <TableRow key={p.id} data-testid="analytics-project">
                      <TableCell>
                        <Link href={`/analytics/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell>{p.artistNames ?? <span className="text-muted-foreground">Not linked</span>}</TableCell>
                      <TableCell>{p.snapshotAsOf ? formatDate(p.snapshotAsOf) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        {p.s4aAsOf ? (
                          formatDate(p.s4aAsOf)
                        ) : p.artists > 0 ? (
                          <Badge variant="outline">No export imported</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
