import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import { spotifyArtists, spotifySnapshots, spotifySyncRuns, spotifyTracks } from "@/db/schema/analytics";
import { projects } from "@/db/schema/tenancy";
import {
  createSpotifyClient,
  parseSpotifyId,
  SpotifyError,
  spotifyConfig,
  type SpotifyArtist,
  type SpotifyClient,
} from "@/lib/spotify/client";
import { ensureDefaultRules } from "./alerts";
import { recordAudit, recordSystemAudit } from "./audit";
import { requireProjectRole } from "./access";
import { conflict, invalid, notFound, type ServiceContext } from "./context";

export const isoDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function spotifyStatus() {
  const config = spotifyConfig();
  return { configured: !!config, mocked: !!process.env.SPOTIFY_API_BASE };
}

// ---------------------------------------------------------------------------------------------
// Linking (gated: see APPROVAL_ACTIONS "spotify.connect" / "spotify.disconnect")

export const linkPayload = z.object({
  projectId: z.string().uuid(),
  spotifyArtistId: z.string().regex(/^[0-9A-Za-z]{22}$/, "That isn't a Spotify artist ID."),
  name: z.string().trim().min(1).max(200),
});

/** Turns a pasted artist URL into a link payload, looking up the name when Spotify is configured. */
export async function resolveArtistInput(ctx: ServiceContext, projectId: string, input: string) {
  await requireProjectRole(db, ctx, projectId, "lead");
  const spotifyArtistId = parseSpotifyId(input, "artist");
  if (!spotifyArtistId) throw invalid("Paste an artist link like https://open.spotify.com/artist/… or a spotify:artist: URI.");
  const config = spotifyConfig();
  if (!config) return { spotifyArtistId, name: null as string | null, verified: false };
  try {
    const artist = await createSpotifyClient(config).getArtist(spotifyArtistId);
    return { spotifyArtistId, name: artist.name, verified: true };
  } catch (err) {
    if (err instanceof SpotifyError && (err.status === 404 || err.status === 400)) throw invalid("Spotify has no artist with that ID.");
    throw invalid(`Couldn't reach Spotify to check the artist (${(err as Error).message}).`);
  }
}

export async function prepareLink(exec: Executor, ctx: ServiceContext, p: z.infer<typeof linkPayload>) {
  const { project } = await requireProjectRole(exec, ctx, p.projectId, "lead");
  if (project.archivedAt) throw invalid("This project is archived.");
  const [existing] = await exec
    .select({ id: spotifyArtists.id })
    .from(spotifyArtists)
    .where(and(eq(spotifyArtists.projectId, p.projectId), eq(spotifyArtists.spotifyArtistId, p.spotifyArtistId), isNull(spotifyArtists.unlinkedAt)));
  if (existing) throw conflict(`${p.name} is already linked to ${project.name}.`);
  return project;
}

export async function linkArtistTx(tx: Executor, ctx: ServiceContext, p: z.infer<typeof linkPayload>) {
  const project = await prepareLink(tx, ctx, p);
  const [row] = await tx
    .insert(spotifyArtists)
    .values({ workspaceId: ctx.workspaceId, projectId: p.projectId, spotifyArtistId: p.spotifyArtistId, name: p.name, linkedBy: ctx.userId })
    .returning();
  await ensureDefaultRules(tx, ctx.workspaceId, p.projectId, ctx.userId);
  await recordAudit(tx, ctx, {
    action: "spotify.artist.linked",
    projectId: p.projectId,
    entityType: "spotify_artist",
    entityId: row.id,
    after: { spotifyArtistId: p.spotifyArtistId, name: p.name, project: project.name },
  });
  return row;
}

export async function getArtistLink(exec: Executor, ctx: ServiceContext, linkId: string) {
  const [row] = await exec
    .select()
    .from(spotifyArtists)
    .where(and(eq(spotifyArtists.id, linkId), eq(spotifyArtists.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Artist link not found.");
  await requireProjectRole(exec, ctx, row.projectId, "viewer");
  return row;
}

export async function unlinkArtistTx(tx: Executor, ctx: ServiceContext, linkId: string) {
  const row = await getArtistLink(tx, ctx, linkId);
  await requireProjectRole(tx, ctx, row.projectId, "lead");
  if (row.unlinkedAt) throw invalid("This artist is already unlinked.");
  await tx.update(spotifyArtists).set({ unlinkedAt: new Date(), unlinkedBy: ctx.userId }).where(eq(spotifyArtists.id, row.id));
  await recordAudit(tx, ctx, {
    action: "spotify.artist.unlinked",
    projectId: row.projectId,
    entityType: "spotify_artist",
    entityId: row.id,
    before: { spotifyArtistId: row.spotifyArtistId, name: row.name },
  });
}

export async function listArtistLinks(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({ link: spotifyArtists, linkedByName: user.name })
    .from(spotifyArtists)
    .leftJoin(user, eq(user.id, spotifyArtists.linkedBy))
    .where(and(eq(spotifyArtists.projectId, projectId), isNull(spotifyArtists.unlinkedAt)))
    .orderBy(spotifyArtists.linkedAt);
}

// ---------------------------------------------------------------------------------------------
// Daily snapshot

export type SnapshotResult = {
  runId: string;
  status: "ok" | "partial" | "error" | "skipped";
  capturedOn: string;
  artists: number;
  tracks: number;
  requests: number;
  retries: number;
  fields: { followers: boolean; popularity: boolean };
  errors: string[];
  projectIds: string[];
};

const MAX_TRACK_LOOKUPS_PER_ARTIST = 100;

async function snapshotArtist(client: SpotifyClient, link: typeof spotifyArtists.$inferSelect, day: string) {
  const artist: SpotifyArtist = await client.getArtist(link.spotifyArtistId);
  const hasPopularity = typeof artist.popularity === "number";
  const hasFollowers = typeof artist.followers?.total === "number";

  const albums = await client.getArtistAlbums(link.spotifyArtistId);
  const found = new Map<string, { name: string; albumName: string; albumType: string; releaseDate: string; durationMs: number | null }>();
  for (const album of albums) {
    const full = await client.getAlbum(album.id);
    for (const t of full.tracks.items) {
      if (t.artists && !t.artists.some((a) => a.id === link.spotifyArtistId)) continue;
      if (!found.has(t.id)) {
        found.set(t.id, { name: t.name, albumName: full.name, albumType: full.album_type, releaseDate: full.release_date, durationMs: t.duration_ms ?? null });
      }
    }
  }

  const known = await db
    .select({ id: spotifyTracks.id, spotifyTrackId: spotifyTracks.spotifyTrackId, isrc: spotifyTracks.isrc })
    .from(spotifyTracks)
    .where(eq(spotifyTracks.artistLinkId, link.id));
  const knownById = new Map(known.map((k) => [k.spotifyTrackId, k]));

  // ISRCs never change, so a track is fetched individually only the first time we see it, or every
  // day when this app can see popularity (Extended Quota Mode). Development Mode has no batch endpoint.
  const details = new Map<string, { isrc: string | null; popularity: number | null }>();
  let lookups = 0;
  for (const id of found.keys()) {
    const needsIsrc = !knownById.get(id)?.isrc;
    if ((needsIsrc || hasPopularity) && lookups < MAX_TRACK_LOOKUPS_PER_ARTIST) {
      lookups++;
      const t = await client.getTrack(id);
      details.set(id, { isrc: t.external_ids?.isrc ?? null, popularity: typeof t.popularity === "number" ? t.popularity : null });
    }
  }

  return db.transaction(async (tx) => {
    await tx
      .update(spotifyArtists)
      .set({ name: artist.name, imageUrl: artist.images?.[0]?.url ?? null })
      .where(eq(spotifyArtists.id, link.id));
    const snap = {
      workspaceId: link.workspaceId,
      projectId: link.projectId,
      capturedOn: day,
      followers: hasFollowers ? artist.followers!.total : null,
      popularity: hasPopularity ? artist.popularity! : null,
    };
    await tx
      .insert(spotifySnapshots)
      .values({ ...snap, entityType: "artist", entityId: link.id, raw: { name: artist.name, genres: artist.genres ?? [], albums: albums.length } })
      .onConflictDoUpdate({
        target: [spotifySnapshots.entityType, spotifySnapshots.entityId, spotifySnapshots.capturedOn],
        set: { followers: snap.followers, popularity: snap.popularity, raw: sql`excluded.raw` },
      });

    for (const [spotifyTrackId, t] of found) {
      const d = details.get(spotifyTrackId);
      const [row] = await tx
        .insert(spotifyTracks)
        .values({
          workspaceId: link.workspaceId,
          projectId: link.projectId,
          artistLinkId: link.id,
          spotifyTrackId,
          name: t.name,
          isrc: d?.isrc ?? null,
          albumName: t.albumName,
          albumType: t.albumType,
          releaseDate: t.releaseDate,
          durationMs: t.durationMs,
          firstSeenOn: day,
          lastSeenOn: day,
        })
        .onConflictDoUpdate({
          target: [spotifyTracks.artistLinkId, spotifyTracks.spotifyTrackId],
          set: {
            name: t.name,
            albumName: t.albumName,
            albumType: t.albumType,
            releaseDate: t.releaseDate,
            lastSeenOn: day,
            ...(d?.isrc ? { isrc: d.isrc } : {}),
          },
        })
        .returning({ id: spotifyTracks.id });
      if (d?.popularity != null) {
        await tx
          .insert(spotifySnapshots)
          .values({ workspaceId: link.workspaceId, projectId: link.projectId, entityType: "track", entityId: row.id, capturedOn: day, popularity: d.popularity })
          .onConflictDoUpdate({
            target: [spotifySnapshots.entityType, spotifySnapshots.entityId, spotifySnapshots.capturedOn],
            set: { popularity: d.popularity },
          });
      }
    }
    return { tracks: found.size, followers: hasFollowers, popularity: hasPopularity };
  });
}

/**
 * Snapshots every linked artist (or one project's). Safe to run more than once a day: the day's
 * rows are updated in place. Never throws for Spotify errors; they're recorded on the run.
 */
export async function runSpotifySnapshot(opts: { trigger: "cron" | "manual"; projectId?: string; now?: Date; sleep?: (ms: number) => Promise<void> }) {
  const day = isoDay(opts.now);
  const config = spotifyConfig();
  const links = await db
    .select()
    .from(spotifyArtists)
    .innerJoin(projects, eq(projects.id, spotifyArtists.projectId))
    .where(
      and(
        isNull(spotifyArtists.unlinkedAt),
        isNull(projects.archivedAt),
        opts.projectId ? eq(spotifyArtists.projectId, opts.projectId) : undefined,
      ),
    );
  const [run] = await db.insert(spotifySyncRuns).values({ trigger: opts.trigger, capturedOn: day }).returning();
  const result: SnapshotResult = {
    runId: run.id,
    status: "ok",
    capturedOn: day,
    artists: 0,
    tracks: 0,
    requests: 0,
    retries: 0,
    fields: { followers: false, popularity: false },
    errors: [],
    projectIds: [],
  };

  if (!config || links.length === 0) {
    result.status = "skipped";
    if (!config) result.errors.push("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET aren't set.");
  } else {
    const client = createSpotifyClient(config, { sleep: opts.sleep });
    for (const { spotify_artists: link } of links) {
      try {
        const r = await snapshotArtist(client, link, day);
        result.artists++;
        result.tracks += r.tracks;
        result.fields.followers ||= r.followers;
        result.fields.popularity ||= r.popularity;
        if (!result.projectIds.includes(link.projectId)) result.projectIds.push(link.projectId);
      } catch (err) {
        result.errors.push(`${link.name}: ${(err as Error).message}`);
        if (err instanceof SpotifyError && (err.quotaExceeded || err.status === 401 || err.status === 400)) break;
      }
    }
    result.requests = client.stats.requests;
    result.retries = client.stats.retries;
    if (result.errors.length) result.status = result.artists > 0 ? "partial" : "error";
  }

  await db
    .update(spotifySyncRuns)
    .set({
      status: result.status,
      artists: result.artists,
      tracks: result.tracks,
      requests: result.requests,
      retries: result.retries,
      fields: result.fields,
      error: result.errors.join("\n").slice(0, 2000) || null,
      finishedAt: new Date(),
    })
    .where(eq(spotifySyncRuns.id, run.id));

  const workspaces = [...new Set(links.map((l) => l.spotify_artists.workspaceId))];
  for (const workspaceId of workspaces) {
    await recordSystemAudit(db, { workspaceId }, {
      action: "spotify.snapshot.completed",
      entityType: "spotify_sync_run",
      entityId: run.id,
      after: { trigger: opts.trigger, status: result.status, capturedOn: day, artists: result.artists, tracks: result.tracks, fields: result.fields },
    });
  }
  return result;
}

export async function latestSyncRun(exec: Executor) {
  const [run] = await exec.select().from(spotifySyncRuns).orderBy(desc(spotifySyncRuns.startedAt)).limit(1);
  return run ?? null;
}

// ---------------------------------------------------------------------------------------------
// Reads for the dashboard and the Analytics agent

export async function artistSeries(exec: Executor, ctx: ServiceContext, projectId: string, days = 90) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  const since = isoDay(new Date(Date.now() - days * 86_400_000));
  return exec
    .select({
      day: spotifySnapshots.capturedOn,
      artistId: spotifySnapshots.entityId,
      followers: spotifySnapshots.followers,
      popularity: spotifySnapshots.popularity,
    })
    .from(spotifySnapshots)
    .where(
      and(
        eq(spotifySnapshots.projectId, projectId),
        eq(spotifySnapshots.entityType, "artist"),
        sql`${spotifySnapshots.capturedOn} >= ${since}`,
      ),
    )
    .orderBy(spotifySnapshots.capturedOn);
}

export async function listTracks(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  const tracks = await exec
    .select()
    .from(spotifyTracks)
    .innerJoin(spotifyArtists, eq(spotifyArtists.id, spotifyTracks.artistLinkId))
    .where(and(eq(spotifyTracks.projectId, projectId), isNull(spotifyArtists.unlinkedAt)))
    .orderBy(desc(spotifyTracks.releaseDate), spotifyTracks.name);
  const ids = tracks.map((t) => t.spotify_tracks.id);
  const pops = ids.length
    ? await exec
        .selectDistinctOn([spotifySnapshots.entityId], { id: spotifySnapshots.entityId, popularity: spotifySnapshots.popularity, day: spotifySnapshots.capturedOn })
        .from(spotifySnapshots)
        .where(and(eq(spotifySnapshots.entityType, "track"), inArray(spotifySnapshots.entityId, ids)))
        .orderBy(spotifySnapshots.entityId, desc(spotifySnapshots.capturedOn))
    : [];
  const pop = new Map(pops.map((p) => [p.id, p]));
  return tracks.map(({ spotify_tracks: t, spotify_artists: a }) => ({ ...t, artistName: a.name, popularity: pop.get(t.id)?.popularity ?? null }));
}
