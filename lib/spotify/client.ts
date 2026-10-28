/**
 * Spotify Web API client (Client Credentials). Used only by the daily snapshot job and the
 * artist-link check. Re-checked against Spotify's rules on 2026-10-28:
 * - New apps are Development Mode only: the owner needs Premium, max 5 allowlisted users, and
 *   non-commercial use. Extended Quota Mode is limited to organisations with 250k+ MAU.
 * - Development Mode responses omit artist `followers`/`popularity` and track `popularity`
 *   (Feb 2026), and batch endpoints and `artists/{id}/top-tracks` are gone. ISRCs (`external_ids`)
 *   are still returned (reverted in March 2026).
 * - Quota is counted per developer account; a quota 429 has `error.reason = "QUOTA_EXCEEDED"`.
 */

export class SpotifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "SpotifyError";
  }
  get quotaExceeded() {
    return this.status === 429 && this.reason === "QUOTA_EXCEEDED";
  }
}

export type SpotifyConfig = { clientId: string; clientSecret: string; apiBase: string; accountsBase: string };

export function spotifyConfig(): SpotifyConfig | null {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    apiBase: (process.env.SPOTIFY_API_BASE || "https://api.spotify.com").replace(/\/$/, ""),
    accountsBase: (process.env.SPOTIFY_ACCOUNTS_BASE || "https://accounts.spotify.com").replace(/\/$/, ""),
  };
}

const MAX_RETRIES = 3;
/** Longest Retry-After we'll sleep for inside one request; longer waits fail the run instead. */
const MAX_RETRY_AFTER_S = 30;
/** Tokens last an hour; refresh a few minutes early. */
const TOKEN_TTL_MS = 55 * 60 * 1000;

let cachedToken: { key: string; token: string; expiresAt: number } | null = null;

export function resetSpotifyTokenCache() {
  cachedToken = null;
}

type Sleep = (ms: number) => Promise<void>;
const defaultSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export type SpotifyStats = { requests: number; retries: number };

export function createSpotifyClient(config: SpotifyConfig, opts: { sleep?: Sleep } = {}) {
  const sleep = opts.sleep ?? defaultSleep;
  const stats: SpotifyStats = { requests: 0, retries: 0 };

  async function token(force = false) {
    const key = `${config.accountsBase}|${config.clientId}`;
    if (!force && cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.token;
    stats.requests++;
    const res = await fetch(`${config.accountsBase}/api/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new SpotifyError(`Spotify rejected the client credentials (${res.status}).`, res.status);
    const body = (await res.json()) as { access_token: string; expires_in?: number };
    const ttl = Math.min(TOKEN_TTL_MS, ((body.expires_in ?? 3600) - 60) * 1000);
    cachedToken = { key, token: body.access_token, expiresAt: Date.now() + ttl };
    return body.access_token;
  }

  async function get<T>(path: string): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      stats.requests++;
      const res = await fetch(`${config.apiBase}/v1${path}`, { headers: { authorization: `Bearer ${await token()}` } });
      if (res.ok) return (await res.json()) as T;
      const body = (await res.json().catch(() => null)) as { error?: { message?: string; reason?: string } } | null;
      const reason = body?.error?.reason;
      const message = body?.error?.message ?? res.statusText;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await token(true);
        continue;
      }
      if (res.status === 429 && reason !== "QUOTA_EXCEEDED" && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "1");
        if (!Number.isFinite(retryAfter) || retryAfter > MAX_RETRY_AFTER_S) {
          throw new SpotifyError(`Spotify asked us to wait ${retryAfter}s; trying again tomorrow.`, 429, reason);
        }
        stats.retries++;
        await sleep(Math.max(1, retryAfter) * 1000);
        continue;
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        stats.retries++;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new SpotifyError(`Spotify ${res.status} on ${path.split("?")[0]}: ${message}`, res.status, reason);
    }
  }

  return {
    stats,
    getArtist: (id: string) => get<SpotifyArtist>(`/artists/${encodeURIComponent(id)}`),
    async getArtistAlbums(id: string) {
      const out: SpotifyAlbumSimple[] = [];
      let path: string | null = `/artists/${encodeURIComponent(id)}/albums?include_groups=album,single&limit=20`;
      while (path && out.length < 200) {
        const page: Paging<SpotifyAlbumSimple> = await get(path);
        out.push(...page.items);
        path = page.next ? page.next.replace(/^https?:\/\/[^/]+\/v1/, "") : null;
      }
      return out;
    },
    getAlbum: (id: string) => get<SpotifyAlbum>(`/albums/${encodeURIComponent(id)}`),
    getTrack: (id: string) => get<SpotifyTrack>(`/tracks/${encodeURIComponent(id)}`),
  };
}

export type SpotifyClient = ReturnType<typeof createSpotifyClient>;

type Paging<T> = { items: T[]; next: string | null; total?: number };

export type SpotifyArtist = {
  id: string;
  name: string;
  images?: { url: string; width?: number | null }[];
  followers?: { total: number } | null;
  popularity?: number | null;
  genres?: string[];
  external_urls?: { spotify?: string };
};

export type SpotifyAlbumSimple = { id: string; name: string; album_type: string; release_date: string; total_tracks?: number };

export type SpotifyTrackSimple = { id: string; name: string; duration_ms?: number; artists?: { id: string }[] };

export type SpotifyAlbum = SpotifyAlbumSimple & { tracks: Paging<SpotifyTrackSimple> };

export type SpotifyTrack = SpotifyTrackSimple & {
  external_ids?: { isrc?: string };
  popularity?: number | null;
  album?: SpotifyAlbumSimple;
};

const ID = /^[0-9A-Za-z]{22}$/;

/** Accepts an open.spotify.com URL, a spotify: URI or a bare ID. */
export function parseSpotifyId(input: string, kind: "artist" | "track"): string | null {
  const s = input.trim();
  if (ID.test(s)) return s;
  const uri = s.match(new RegExp(`^spotify:${kind}:([0-9A-Za-z]{22})$`));
  if (uri) return uri[1];
  try {
    const url = new URL(s);
    if (!/(^|\.)spotify\.com$/.test(url.hostname)) return null;
    const m = url.pathname.match(new RegExp(`/${kind}/([0-9A-Za-z]{22})(?:/|$)`));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
