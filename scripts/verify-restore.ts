/**
 * Checks that a restored database (e.g. a Neon branch created from a point in time) is complete
 * and untampered. Read-only. Usage:
 *
 *   DATABASE_URL=<restored branch URL> pnpm verify:restore
 *
 * Exits non-zero if any check fails.
 */
import "dotenv/config";
import { readdirSync } from "node:fs";
import postgres from "postgres";

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  try {
    const expected = readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).length;
    const [{ applied }] = await sql<{ applied: number }[]>`select count(*)::int as applied from drizzle.__drizzle_migrations`;
    add("migrations", applied === expected, `${applied} applied, ${expected} in the repo`);

    const breaks = await sql<{ broken_id: string; reason: string }[]>`select * from audit_verify_chain()`;
    const [head] = await sql<{ id: string; hash: string; created_at: Date }[]>`select id, hash, created_at from audit_events order by id desc limit 1`;
    add(
      "audit chain",
      breaks.length === 0,
      breaks.length ? `${breaks.length} problem(s), first at #${breaks[0].broken_id}: ${breaks[0].reason}` : `intact; head #${head?.id} ${head?.hash?.slice(0, 12)}… at ${head?.created_at?.toISOString()}`,
    );

    const [lyrics] = await sql<{ total: number; bad: number }[]>`
      select count(*)::int as total,
             count(*) filter (where content_sha256 <> encode(sha256(convert_to(body, 'UTF8')), 'hex'))::int as bad
      from lyric_versions`;
    add("lyric version hashes", lyrics.bad === 0, `${lyrics.total} versions, ${lyrics.bad} mismatched`);

    const [files] = await sql<{ total: number; bad: number }[]>`
      select count(*)::int as total, count(*) filter (where sha256 <> encode(sha256(data), 'hex'))::int as bad from stored_files`;
    add("stored file hashes", files.bad === 0, `${files.total} files, ${files.bad} mismatched`);

    const counts = await sql<{ t: string; n: number }[]>`
      select 'workspaces' as t, count(*)::int as n from workspaces
      union all select 'users', count(*)::int from "user"
      union all select 'projects', count(*)::int from projects
      union all select 'expenses', count(*)::int from expenses
      union all select 'lyric_works', count(*)::int from lyric_works
      union all select 'rights_packages', count(*)::int from rights_packages
      union all select 's4a_metrics', count(*)::int from s4a_metrics
      union all select 'spotify_snapshots', count(*)::int from spotify_snapshots
      union all select 'audit_events', count(*)::int from audit_events`;
    add("row counts", counts.find((c) => c.t === "workspaces")!.n > 0, counts.map((c) => `${c.t}=${c.n}`).join(" "));

    const [latest] = await sql<{ at: Date | null }[]>`select max(created_at) as at from audit_events`;
    add("latest activity", !!latest.at, latest.at ? latest.at.toISOString() : "none");
  } finally {
    await sql.end();
  }

  for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(22)} ${c.detail}`);
  if (checks.some((c) => !c.ok)) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
