import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://ensemble:ensemble@localhost:5432/ensemble_e2e";

export const MOCK_LLM_URL = `http://localhost:${process.env.MOCK_LLM_PORT ?? 4110}`;
/** Real keys in the environment are used as-is; otherwise both providers point at the local mock. */
export const USING_MOCK_LLM = !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY;
const llmEnv: Record<string, string> = USING_MOCK_LLM
  ? {
      ANTHROPIC_API_KEY: "mock-anthropic",
      ANTHROPIC_BASE_URL: `${MOCK_LLM_URL}/anthropic/v1`,
      OPENAI_API_KEY: "mock-openai",
      OPENAI_BASE_URL: `${MOCK_LLM_URL}/openai/v1`,
    }
  : {};

/** The Spotify Web API is always mocked in e2e; real credentials would hit Spotify's per-developer quota. */
export const MOCK_SPOTIFY_URL = `http://localhost:${process.env.MOCK_SPOTIFY_PORT ?? 4120}`;
export const E2E_CRON_SECRET = "e2e-cron-secret";
const spotifyEnv = {
  SPOTIFY_CLIENT_ID: "mock-client",
  SPOTIFY_CLIENT_SECRET: "mock-secret",
  SPOTIFY_API_BASE: MOCK_SPOTIFY_URL,
  SPOTIFY_ACCOUNTS_BASE: MOCK_SPOTIFY_URL,
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `node tests/mocks/llm-server.mjs`,
          url: `${MOCK_LLM_URL}/health`,
          reuseExistingServer: !process.env.CI,
          env: { MOCK_LLM_PORT: new URL(MOCK_LLM_URL).port },
        },
        {
          command: `node tests/mocks/spotify-server.mjs`,
          url: `${MOCK_SPOTIFY_URL}/health`,
          reuseExistingServer: !process.env.CI,
          env: { MOCK_SPOTIFY_PORT: new URL(MOCK_SPOTIFY_URL).port },
        },
        {
          command: `pnpm exec next dev --port ${PORT}`,
          url: `${baseURL}/sign-in`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            DATABASE_URL: E2E_DATABASE_URL,
            BETTER_AUTH_URL: baseURL,
            NEXT_PUBLIC_APP_URL: baseURL,
            NEXT_DIST_DIR: ".next-e2e",
            CRON_SECRET: E2E_CRON_SECRET,
            ...spotifyEnv,
            ...llmEnv,
          },
        },
      ],
});
