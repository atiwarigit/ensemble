import { execSync } from "node:child_process";
import "dotenv/config";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://ensemble:ensemble@localhost:5432/ensemble_test";
  const env = { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "" };
  execSync("pnpm exec tsx scripts/reset-db.ts", { env, stdio: "inherit" });
  execSync("pnpm exec tsx scripts/migrate.ts", { env, stdio: "inherit" });
}
