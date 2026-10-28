// A stand-in for the Spotify accounts service and the Web API endpoints Ensemble uses.
//
//   SPOTIFY_ACCOUNTS_BASE=http://localhost:4020  SPOTIFY_API_BASE=http://localhost:4020
//
// mode "development" (default) mirrors Development Mode since Feb 2026: artist followers/popularity
// and track popularity are omitted. mode "extended" returns them.
// POST /__control {"mode":"extended","artist":{"id":"…","followers":1200,"popularity":52},
//                  "rateLimit":1, "quotaExceeded":true, "serverError":1}
// GET  /__calls   request counts by path pattern;  POST /__reset
import http from "node:http";
import { pathToFileURL } from "node:url";

export const XANIA_ID = "3XaniaMockArtistId0001";

function fixtures() {
  return {
    artists: {
      [XANIA_ID]: {
        id: XANIA_ID,
        name: "Xania",
        genres: ["alt pop"],
        images: [{ url: "https://i.scdn.co/image/mock-xania", width: 640, height: 640 }],
        followers: 12_480,
        popularity: 52,
        albums: ["XaniaAlbumGlassRivers01", "XaniaSinglePaperLantr01"],
      },
    },
    albums: {
      XaniaAlbumGlassRivers01: {
        id: "XaniaAlbumGlassRivers01",
        name: "Glass Rivers",
        album_type: "album",
        release_date: "2026-10-17",
        tracks: [
          { id: "XaniaTrackGlassRivers1", name: "Glass Rivers", isrc: "USX9P2600001", duration_ms: 201000, popularity: 48 },
          { id: "XaniaTrackNeonSaints01", name: "Neon Saints", isrc: "USX9P2600002", duration_ms: 188000, popularity: 41 },
          { id: "XaniaTrackUndertow0001", name: "Undertow", isrc: "USX9P2600003", duration_ms: 224000, popularity: 37 },
        ],
      },
      XaniaSinglePaperLantr01: {
        id: "XaniaSinglePaperLantr01",
        name: "Paper Lanterns",
        album_type: "single",
        release_date: "2026-03-06",
        tracks: [{ id: "XaniaTrackPaperLantrn1", name: "Paper Lanterns", isrc: "USX9P2600004", duration_ms: 176000, popularity: 44 }],
      },
    },
  };
}

export function createMockSpotifyServer() {
  let data = fixtures();
  let mode = "development";
  let rateLimit = 0;
  let quotaExceeded = false;
  let serverError = 0;
  const calls = {};
  const tokens = new Set();
  const count = (k) => (calls[k] = (calls[k] ?? 0) + 1);

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const trackObj = (t, album) => ({
    id: t.id,
    name: t.name,
    duration_ms: t.duration_ms,
    artists: [{ id: XANIA_ID }],
    external_ids: { isrc: t.isrc },
    ...(mode === "extended" ? { popularity: t.popularity } : {}),
    album: album && { id: album.id, name: album.name, album_type: album.album_type, release_date: album.release_date },
  });

  return http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url ?? "/", "http://x");
    const p = url.pathname;

    if (p === "/__control") {
      const b = raw ? JSON.parse(raw) : {};
      if (b.mode) mode = b.mode;
      if (b.artist) Object.assign(data.artists[b.artist.id ?? XANIA_ID], b.artist);
      if (b.track) {
        for (const a of Object.values(data.albums)) for (const t of a.tracks) if (t.id === b.track.id) Object.assign(t, b.track);
      }
      if (b.rateLimit != null) rateLimit = b.rateLimit;
      if (b.quotaExceeded != null) quotaExceeded = b.quotaExceeded;
      if (b.serverError != null) serverError = b.serverError;
      return res.writeHead(204).end();
    }
    if (p === "/__reset") {
      data = fixtures();
      mode = "development";
      rateLimit = serverError = 0;
      quotaExceeded = false;
      for (const k of Object.keys(calls)) delete calls[k];
      return res.writeHead(204).end();
    }
    if (p === "/__calls") return json(res, 200, calls);
    if (p === "/health") return res.writeHead(200).end("ok");

    if (p === "/api/token" && req.method === "POST") {
      count("token");
      const auth = Buffer.from(String(req.headers.authorization ?? "").replace(/^Basic /, ""), "base64").toString();
      if (!raw.includes("grant_type=client_credentials") || !auth.includes(":") || auth.endsWith(":wrong")) {
        return json(res, 400, { error: "invalid_client", error_description: "Invalid client" });
      }
      const token = `mock-${Date.now().toString(36)}-${tokens.size}`;
      tokens.add(token);
      return json(res, 200, { access_token: token, token_type: "Bearer", expires_in: 3600 });
    }

    if (!p.startsWith("/v1/")) return json(res, 404, { error: { status: 404, message: "Not found" } });
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!tokens.has(bearer)) return json(res, 401, { error: { status: 401, message: "Invalid access token" } });
    if (quotaExceeded) return json(res, 429, { error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" } });
    if (rateLimit > 0) {
      rateLimit--;
      return json(res, 429, { error: { status: 429, message: "API rate limit exceeded" } }, { "retry-after": "1" });
    }
    if (serverError > 0) {
      serverError--;
      return json(res, 502, { error: { status: 502, message: "Bad gateway" } });
    }

    let m;
    if ((m = p.match(/^\/v1\/artists\/([^/]+)$/))) {
      count("artist");
      const a = data.artists[m[1]];
      if (!a) return json(res, 404, { error: { status: 404, message: "Resource not found" } });
      return json(res, 200, {
        id: a.id,
        name: a.name,
        type: "artist",
        uri: `spotify:artist:${a.id}`,
        genres: a.genres,
        images: a.images,
        external_urls: { spotify: `https://open.spotify.com/artist/${a.id}` },
        ...(mode === "extended" ? { followers: { href: null, total: a.followers }, popularity: a.popularity } : {}),
      });
    }
    if ((m = p.match(/^\/v1\/artists\/([^/]+)\/albums$/))) {
      count("artist_albums");
      const a = data.artists[m[1]];
      if (!a) return json(res, 404, { error: { status: 404, message: "Resource not found" } });
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const all = a.albums.map((id) => data.albums[id]);
      const items = all.slice(offset, offset + limit).map(({ tracks, ...al }) => ({ ...al, total_tracks: tracks.length }));
      const next = offset + limit < all.length ? `http://${req.headers.host}/v1/artists/${a.id}/albums?offset=${offset + limit}&limit=${limit}` : null;
      return json(res, 200, { items, next, total: all.length, limit, offset });
    }
    if ((m = p.match(/^\/v1\/albums\/([^/]+)$/))) {
      count("album");
      const al = data.albums[m[1]];
      if (!al) return json(res, 404, { error: { status: 404, message: "Resource not found" } });
      const { tracks, ...rest } = al;
      return json(res, 200, {
        ...rest,
        tracks: { items: tracks.map((t) => ({ id: t.id, name: t.name, duration_ms: t.duration_ms, artists: [{ id: XANIA_ID }] })), next: null },
      });
    }
    if ((m = p.match(/^\/v1\/tracks\/([^/]+)$/))) {
      count("track");
      for (const al of Object.values(data.albums)) {
        const t = al.tracks.find((x) => x.id === m[1]);
        if (t) return json(res, 200, trackObj(t, al));
      }
      return json(res, 404, { error: { status: 404, message: "Resource not found" } });
    }
    if (p === "/v1/artists" || p === "/v1/tracks" || p.endsWith("/top-tracks")) {
      return json(res, 403, { error: { status: 403, message: "This endpoint is not available in Development Mode" } });
    }
    return json(res, 404, { error: { status: 404, message: "Not found" } });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.MOCK_SPOTIFY_PORT ?? 4020);
  createMockSpotifyServer().listen(port, () => console.log(`mock Spotify on http://localhost:${port}`));
}
