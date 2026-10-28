import { execSync } from "node:child_process";
import { E2E_DATABASE_URL } from "../../playwright.config";

export default function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, DATABASE_URL_UNPOOLED: "" };
  for (const script of ["scripts/reset-db.ts", "scripts/migrate.ts", "scripts/seed.ts"]) {
    execSync(`pnpm exec tsx ${script}`, { env, stdio: "inherit" });
  }
}
