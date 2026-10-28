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
| Lyrics: immutable timestamped + hashed versions, diffs, contributor splits, evidence files, AI generation log | ✅ |
| Approvals queue for gated actions; rights documentation packages (PDF + ZIP with SHA256SUMS) | ✅ |
| Coordinator chat with Finance and Lyrics agents; Anthropic and/or OpenAI optional, slash commands without either | ✅ |

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
lib/rights/pdf.tsx   rights package PDF (@react-pdf/renderer)
lib/csv/             CSV decoding, mapping guesses, parsing, dedupe hashing (pure, unit tested)
samples/bank-csv/    sample bank statements for import testing
samples/lyrics/      a sample poem and notebook-page photo for the authorship flow
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
- Reverts and imports over 500 rows go through the approvals queue (see below). A project lead or
  workspace owner approves project imports; personal imports need a workspace owner.

Sample statements for testing live in `samples/bank-csv/`:

| File | Shape |
| --- | --- |
| `chase-checking-2026-10.csv` | Negative = spend, `MM/DD/YYYY`, includes a transfer, a refund and a duplicate charge |
| `amex-gold-2026-10.csv` | Positive = spend, card member and account columns |
| `capital-one-2026-q3.csv` | Separate Debit / Credit columns, ISO dates |
| `messy-semicolon-latin1.csv` | Latin-1, `;` delimiter, `DD/MM/YYYY`, decimal commas, three bad rows |

### Lyrics and authorship

- A lyric work belongs to one project. Every save creates a new `lyric_versions` row; versions are
  never edited. Triggers reject UPDATE/DELETE/TRUNCATE on `lyric_versions` and UPDATE/DELETE on
  `lyric_evidence` and `generation_links`.
- The `BEFORE INSERT` trigger sets `recorded_at = clock_timestamp()` and
  `content_sha256 = sha256(body)`, so neither the time nor the hash can come from the client. Each
  `lyric.version.created` audit event carries the same hash, tying the text to the audit chain.
- Text is normalised before hashing (CRLF → LF, trailing spaces trimmed), so the same lyrics always
  hash the same. `sha256sum` of a version's text (no trailing newline) matches the stored hash.
- "Date written" is stored separately as `claimed_written_at` and always labelled *stated by the
  author*. Ensemble only proves when it recorded the text.
- Saves carry the version they were based on; a save on top of a newer version is rejected instead
  of overwriting it. Saving unchanged text is rejected.
- Contributor shares are stored in basis points (10000 = 100%), must total 100%, and need at least
  one human lyricist. Once a work is final, text and split are locked; changes go through approvals.
- Evidence files (up to 10 MB) are stored in Postgres (`stored_files.data`, `bytea`) with their
  SHA-256, so no blob store is needed. Downloads are audited.
- An AI generation log entry must reference a recorded lyric version of the same work, so a work with
  no human lyrics can't have generations.

### Approvals

Gated actions (plan §3.5) never run directly. They create an `approval_requests` row holding the
validated payload, and run only when someone approves it. The action registry is
`APPROVAL_ACTIONS` in `lib/services/approvals.ts`:

| Action | Who can request | Who can approve |
| --- | --- | --- |
| `lyric.finalize`: lock text and split, issue the final rights package | editor | project lead or owner |
| `lyric.contributors.change`: new split on a final work, plus a new final package | editor | project lead or owner |
| `import.commit_large`: commit an import over 500 rows | editor | project lead, or owner for personal imports |
| `import.revert`: revert any import | editor, or the uploader for personal imports | project lead, or owner for personal imports |
| `project.archive` | project lead | workspace owner |
| `project.allow_llm_on_lyrics`: let AI models read the project's lyrics | project lead | workspace owner |

- On approval, the payload is re-validated against current state and executed under the
  **approver's** identity, inside a savepoint. If it no longer applies (for example, the import was
  already reverted), the request is marked `failed` and nothing changes. `approval.requested`,
  `approval.approved`, `approval.executed` / `approval.failed`, `approval.rejected`,
  `approval.withdrawn` and `approval.expired` are all audited.
- A requester can't approve their own request, unless they're a workspace owner. An owner's
  self-approval is recorded with `selfApproved: true` and badged in the history.
- Requests expire after 7 days (checked lazily on read and write). Only one pending request per
  action and record. A trigger makes decided requests immutable and rejects deletes.
- Unarchiving a project and turning AI access to lyrics *off* are not gated.

### Rights packages

`/lyrics/<id>/rights` previews the package. Editors can generate a **draft** package at any time; it
carries a DRAFT watermark. The **final** package is generated when a `lyric.finalize` request is
approved, and again after an approved split change. Packages are stored in Postgres
(`rights_packages` + `stored_files`), are append-only, and every download is audited.

The ZIP contains:

```
rights-package.pdf     title/ISRC/ISWC, splits, authorship timeline, evidence, generation log,
                       human vs. AI statement, audit excerpt with chain head, attestation block
manifest.json          the same records as JSON (format "ensemble.rights-package/1")
versions/v001.txt …    the exact text of each version; sha256 matches contentSha256
evidence/01-…          the evidence files as uploaded
SHA256SUMS             sha256 of every other file. Check with `sha256sum -c SHA256SUMS`
```

Each version in `manifest.json` names the audit event that recorded it (`auditEventId`,
`auditEventHash`), so the package can be checked against the audit log. The PDF footer states the
limitation: these records prove when Ensemble recorded the text, not when it was written. The PDF
uses the built-in Latin-1 fonts; text outside Latin-1 is exact in the `.txt` files but may not
render in the PDF.

### Coordinator chat and agents

`/chat` starts a thread scoped to one project or to all of the user's projects. Threads are private
to the person who started them. `POST /api/chat` saves the user message, then `runChatTurn`
(`lib/agents/coordinator.ts`) streams the answer.

- **Agents are tool sets.** `lib/agents/finance.ts` and `lib/agents/lyrics.ts` each expose tools
  (`finance_summarizeSpend`, `lyrics_lyricHistory`, …) that call the same services as the UI. Tools
  run as `actorType: "agent"` on behalf of the signed-in user, so they can never do more than that
  user. Every call is audited as `agent.tool.called` with the agent, tool, input and result summary,
  and each turn as `agent.coordinator.turn`. Gated actions (finalize) only file an approval request.
- **Providers** (`lib/llm/providers.ts`). Keys are read from the environment on every request.
  Order: `LLM_PROVIDER`, then the workspace setting (Settings → AI assistant, owners), then
  Anthropic, then OpenAI. If the primary fails with 429/5xx *before* producing output, the other
  configured provider gets one try. Otherwise, or with no key, the turn is answered in command mode
  with a notice. Every model call is logged in `llm_calls` with tokens and estimated cost.
- **Command mode.** Slash commands (`/help`, `/expenses summary october`, `/lyric history "Title"`,
  `/lyric list missing`, `/export rights "Title"`, `/finalize "Title"`, `/budget`) always run without
  a model, even when keys are set. Free text is matched against a keyword table, which can fan out to
  several agents. A command missing an argument shows a small form.
- **Budget.** When the month's estimated spend reaches the budget, turns are answered with commands
  and a `blocked` call is logged. Lowering is direct; raising goes through `llm.budget.raise`.
- **Lyric privacy.** The model sees lyric *text* only through `lyrics_readLyricText`, and only in
  projects where `project.allow_llm_on_lyrics` is on. Elsewhere it sees titles and metadata.
- **Suggestions.** `lyrics_proposeLyricEdit` stores a suggestion (`lyric_suggestions`); it never
  writes a version. On the lyric page a person can edit, accept or dismiss it. Accepting creates a
  version with origin `human_edit_of_ai_suggestion`, which the rights package reports. Only a
  suggestion based on the latest version can be accepted. A trigger keeps suggestion text and
  provenance immutable.
- History is sent to the model as text plus a digest of earlier tool results, so a thread can switch
  provider mid-way. Each project keeps a short rolling `project_context` of recent tool results.

Tests never call a real provider unless keys are already in the environment.
`tests/mocks/llm-server.mjs` speaks the Anthropic Messages and OpenAI Responses streaming protocols,
picks tools from keywords, and can be told to fail (`POST /__control`). Playwright starts it on
:4110 and points both SDKs at it; with real keys set, it uses them instead.
