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
| Expenses: manual entry, categories, project or personal allocation, soft delete | ✅ |
| Bank CSV import: column mapping, saved presets, preview, dedupe, revert | ✅ |
| Categorization rules, budgets with alert thresholds, monthly reports, CSV export | ✅ |

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
pnpm db:seed      # workspace "dai + drm", Romel (owner), Nikki (member), default categories and rules

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
lib/csv/             CSV decoding, mapping guesses, parsing, dedupe hashing (pure, unit tested)
samples/bank-csv/    sample bank statements for import testing
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

### Expenses and CSV import

- Amounts are stored as integer minor units (`amount_minor`) with a `currency` column. Only USD is
  accepted today (`SUPPORTED_CURRENCIES` in `lib/csv/expenses-csv.ts`); rows in other currencies
  are reported as errors rather than converted.
- An expense belongs to a project (visible to project members) or is personal/unallocated (visible
  to its creator and workspace owners).
- Import flow: upload → the raw CSV is held on the `import_batches` row → map columns (a preset
  saved for the same header signature is applied automatically) → preview → commit in one
  transaction, which clears the raw CSV and writes one `import.committed` audit event.
  Files are decoded as UTF-8 with a Windows-1252 fallback, and the delimiter is detected.
- Dedupe key: `sha256(workspace, date, amount, normalized description, account last 4, occurrence)`.
  `occurrence` is the row's index among identical rows in the same file, so two genuine identical
  charges on one statement both import, while re-importing the file skips them.
- Credits, refunds and transfers are excluded, not imported as negative expenses. Account numbers
  are masked to the last 4 digits.
- Reverting a batch archives its expenses (they stay in the DB for the audit trail) and frees their
  dedupe keys so the file can be imported again.
- Until the approvals queue lands, reverts and imports over 500 rows require the project lead (or a
  workspace owner for personal imports).

Sample statements for testing live in `samples/bank-csv/`:

| File | Shape |
| --- | --- |
| `chase-checking-2026-10.csv` | Negative = spend, `MM/DD/YYYY`, includes a transfer, a refund and a duplicate charge |
| `amex-gold-2026-10.csv` | Positive = spend, card member and account columns |
| `capital-one-2026-q3.csv` | Separate Debit / Credit columns, ISO dates |
| `messy-semicolon-latin1.csv` | Latin-1, `;` delimiter, `DD/MM/YYYY`, decimal commas, three bad rows |
