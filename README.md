# Ensemble

Private multi-agent workspace for **dai + drm** songwriters and managers. Phase 1 covers expense
tracking, lyric authorship logging, and basic analytics behind a single coordinator. See the Phase 1
build plan for the full scope.

**Stack:** Next.js 16 (App Router, Server Actions) · Postgres + Drizzle ORM · Better Auth (email +
password, TOTP 2FA) · shadcn/ui + Tailwind 4 · Zod · Vitest + Playwright.

## What's here

| Area | Status |
| --- | --- |
| Invite-only accounts, TOTP 2FA (required for owners/admins) | ✅ |
| Workspace members, roles, invites (copy link or email via Resend) | ✅ |
| Private projects with lead / editor / viewer membership | ✅ |
| Append-only, hash-chained audit log with chain verification | ✅ |

## Local development

Requirements: Node 22+, pnpm 10, Postgres 16 running locally.

```bash
# 1. Databases (dev, unit tests, e2e tests)
sudo -u postgres psql -c "create role ensemble login superuser password 'ensemble';"
for db in ensemble ensemble_test ensemble_e2e; do sudo -u postgres createdb -O ensemble $db; done

# 2. Env
cp .env.example .env
# set BETTER_AUTH_SECRET: openssl rand -base64 32

# 3. Install, migrate, seed
pnpm install
pnpm db:migrate
pnpm db:seed      # workspace "dai + drm", Romel (owner) and Nikki (member)

# 4. Run
pnpm dev          # http://localhost:3000
```

Seeded users sign in with `SEED_PASSWORD` (dev default: `ensemble-dev-password`). Owners and admins
are asked to enrol an authenticator app on first sign-in. For local testing,
`pnpm totp "<secret or otpauth:// URI>"` prints the current code for the secret shown during enrolment.

`pnpm db:reset` drops and recreates the local database (it refuses to run against non-local hosts).

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server |
| `pnpm typecheck` / `pnpm lint` | Route typegen + `tsc`, ESLint |
| `pnpm test` | Vitest integration tests against `TEST_DATABASE_URL` (reset + migrated on each run) |
| `pnpm test:e2e` | Playwright against a dev server on :3100 using `E2E_DATABASE_URL` (reset + seeded on each run) |
| `pnpm db:generate` | Generate a migration from `db/schema` changes |
| `pnpm db:migrate` / `pnpm db:seed` | Apply migrations / seed the workspace and first users |

## Environment variables

| Var | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres URL. In production, the Neon **pooled** URL. |
| `DATABASE_URL_UNPOOLED` | prod | Direct URL used by `pnpm db:migrate`. Falls back to `DATABASE_URL`. |
| `BETTER_AUTH_SECRET` | yes | 32+ random bytes (`openssl rand -base64 32`). Also encrypts TOTP secrets, so don't rotate casually. |
| `BETTER_AUTH_URL` | yes | Canonical app URL, e.g. `https://ensemble.example.com`. |
| `NEXT_PUBLIC_APP_URL` | yes | Same as above; used to build invite links. |
| `BOOTSTRAP_OWNER_EMAIL` | seed | First owner (Romel). |
| `BOOTSTRAP_OWNER_NAME` | no | Default `Romel`. |
| `SEED_MEMBER_EMAIL` / `SEED_MEMBER_NAME` | no | Optional second seeded user (Nikki, member). |
| `SEED_PASSWORD` | prod seed | Initial password for seeded users. Required when `NODE_ENV=production`. |
| `REQUIRE_2FA_FOR_ADMINS` | no | Default `true`. |
| `RESEND_API_KEY`, `EMAIL_FROM` | no | Send invite emails. Without them, admins copy the invite link. |
| `TEST_DATABASE_URL`, `E2E_DATABASE_URL` | tests | Separate databases for Vitest and Playwright. |

## Deploying to Vercel + Neon

Nothing is provisioned by this repo. To deploy:

1. **Create the Vercel project** from this GitHub repo (framework preset: Next.js).
2. **Add Postgres** via the Vercel Marketplace → Neon. This injects `DATABASE_URL` (pooled) and
   `DATABASE_URL_UNPOOLED` into Production and Preview. Enable Neon branching for previews if wanted.
3. **Set env vars** in the Vercel project for Production (and Preview): `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `BOOTSTRAP_OWNER_EMAIL`, `SEED_MEMBER_EMAIL`,
   `SEED_PASSWORD`, and optionally `RESEND_API_KEY` / `EMAIL_FROM`.
4. **Migrate and seed** from a trusted machine against production:
   ```bash
   vercel env pull .env.production.local
   DATABASE_URL=... DATABASE_URL_UNPOOLED=... pnpm db:migrate
   NODE_ENV=production pnpm db:seed
   ```
   Change the seeded passwords on first sign-in (Romel will be forced to enrol 2FA).
5. **Lock down the audit log role (recommended).** The triggers already reject UPDATE/DELETE/TRUNCATE
   on `audit_events`. For defence in depth, run the app with a role that only has
   `INSERT, SELECT` on `audit_events` (and its sequence), and keep the owner role for migrations:
   ```sql
   REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM app_role;
   GRANT INSERT, SELECT ON audit_events TO app_role;
   GRANT USAGE ON SEQUENCE audit_events_id_seq TO app_role;
   ```
6. **Turn on Deployment Protection** for Preview deployments.
7. Deploy. Run `pnpm db:migrate` before (or as part of) each deploy that adds migrations.

## Project layout

```
app/                 routes (sign-in, invite, setup-2fa, (app)/… authenticated pages)
components/          app components; components/ui = shadcn
db/schema, db/migrations
lib/auth.ts          Better Auth server config (+ auth audit hooks)
lib/authz.ts         session → ServiceContext, Server Action wrapper
lib/services/*       the only code that writes the DB; every mutation audits in the same transaction
scripts/             migrate, seed, reset-db, totp
tests/unit, tests/e2e
```

### Authorization model

- `requireProjectRole(exec, ctx, projectId, minRole)` in `lib/services/access.ts` is the single gate for
  project-scoped work. Projects are private: visible to their members and to workspace owners only.
  Projects the caller can't see return "not found" so their existence isn't leaked.
- Workspace roles: `owner > admin > member > viewer`. Owners act as lead on every project. Admins
  manage members and invites but don't automatically see projects.

### Audit log

`audit_events` is append-only (triggers reject UPDATE/DELETE/TRUNCATE). A `BEFORE INSERT` trigger
takes an advisory lock and sets `prev_hash` and `hash = sha256(prev_hash || canonical_json(row))`,
so ordering matches commit order. `audit_verify_chain()` recomputes the chain; owners see the result on
the Audit log page.
