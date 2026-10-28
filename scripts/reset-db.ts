// Local development only: drops every table (including the append-only audit log) and the
// migration journal so `pnpm db:migrate` starts from scratch.
import "dotenv/config";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const host = new URL(url).hostname;
  if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Refusing to reset non-local database (${host}).`);
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  await client.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await client.end();
  console.log(`Reset ${host}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
