# Security review (Phase 1)

Reviewed 2026-10-28 against the Milestone 6 code. Each item says what protects it and where. "Open"
items are decisions or follow-ups for the workspace owner.

## Accounts and sessions

| Risk | Control | Where |
| --- | --- | --- |
| Strangers sign up | Public sign-up is disabled. Accounts come only from invites (hashed token, 7-day expiry, single use). | `lib/auth.ts`, `lib/services/invites.ts` |
| Password guessing | 10 failed passwords per email per address per 15 min, then "Too many attempts". 100 password attempts per address per 15 min. Counters live in Postgres, so they hold across serverless instances. Lockouts are audited (`auth.rate_limited`). | `lib/rate-limit.ts`, `lib/auth.ts` |
| TOTP guessing | 5 code attempts per pending sign-in; after that a fresh password step is needed (which is itself limited). | same |
| Stolen session | Sessions last 7 days, cookies are `HttpOnly`, `SameSite=Lax`, `Secure` in production. Expired sessions are deleted daily. | `lib/auth.ts`, `lib/jobs.ts` |
| Owner/admin without 2FA | Owners and admins must enrol TOTP before any page loads (`REQUIRE_2FA_FOR_ADMINS`). | `lib/authz.ts` |

## Authorization

| Risk | Control | Where |
| --- | --- | --- |
| Seeing another project's data | Every read and write goes through `requireProjectRole`. Projects you aren't on return 404, not 403. Covered by unit and e2e tests (outsider, viewer, editor). | `lib/services/access.ts` |
| Agents doing more than the user | Agent tools run with the signed-in user's context (`actorType: "agent"`) and the same services. Gated actions only file approval requests. | `lib/agents/*` |
| AI reading private lyrics | Lyric text reaches a model only via `lyrics_readLyricText`, only where an owner approved `project.allow_llm_on_lyrics`. | `lib/agents/lyrics.ts` |
| Risky changes without a second person | Finalizing, split changes on final works, large imports, reverts, archiving, AI lyric access, raising the AI budget, and linking/unlinking Spotify artists are approval-gated. An owner's self-approval is flagged. | `lib/services/approvals.ts` |
| Cron endpoints called by anyone | `/api/cron/*` require `Authorization: Bearer $CRON_SECRET` (constant-time compare); 503 if the secret isn't set. | `lib/cron.ts` |

## Data integrity

| Risk | Control | Where |
| --- | --- | --- |
| Editing history | `audit_events`, `lyric_versions`, rights packages and decided approvals are append-only (triggers). The audit log is a SHA-256 hash chain. | `db/migrations/0001…`, `0004…`, `0005…` |
| Silent tampering in the DB | The audit-verify cron re-checks the whole chain daily. On a break it notifies owners and admins in-app, and emails owners plus `AUDIT_ALERT_EMAIL` once per break. | `lib/jobs.ts` |
| Losing data | Neon PITR plus a monthly restore drill with `pnpm verify:restore`. | `docs/backups-and-restore.md` |
| Duplicate or bad imports | Dedupe keys for expenses and S4A points; preview before commit; reverts are gated and archive rather than delete. | `lib/services/imports.ts`, `lib/services/s4a.ts` |

## Web

| Risk | Control | Where |
| --- | --- | --- |
| Clickjacking, MIME sniffing | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`, `nosniff`, strict referrer policy, HSTS, no `X-Powered-By`. | `next.config.ts` |
| CSRF | Server Actions check the Origin header (Next.js); auth endpoints use Better Auth's origin checks; cookies are `SameSite=Lax`. | framework |
| XSS | React escaping. The only `dangerouslySetInnerHTML` is shadcn's chart, which writes CSS colour variables from constants. Model output is rendered as text and markdown links only. | `app/(app)/chat` |
| Upload abuse | CSV and evidence uploads are capped at 10 MB. CSVs are parsed, never executed. Evidence and packages are served with `Content-Disposition: attachment`. | `lib/csv/*`, `app/api/lyrics/evidence` |
| Chat abuse / cost | 30 messages per user per 5 min (429 with `Retry-After`), plus the monthly AI budget. | `app/api/chat/route.ts` |

## Third parties and secrets

- Secrets are only read from environment variables on the server. None are sent to the browser.
  The System page shows only whether each one is set.
- **Spotify:** Client Credentials only (no user tokens), public catalogue data, and S4A numbers come
  from files the team exports themselves. Nothing is scraped.
- **LLM providers:** only the text of the chat, tool summaries and (where approved) lyric text are
  sent. Provider calls are logged with token counts in `llm_calls`.
- **Resend:** invite and alert emails only.

## Retention

The daily retention job removes abandoned import previews after 7 days (they hold the raw CSV), raw
Spotify responses after 90 days, notifications after 180 days, job history after 90 days, old
rate-limit windows, and expired sessions and verification tokens. It expires stale approvals. Audit
events, lyric versions, evidence and rights packages are never deleted.

## Incident: the audit chain fails verification

1. Don't change anything in the database. The broken event ID is in the notification and the email.
2. Create a Neon branch from a point before the broken event's `created_at` and run
   `pnpm verify:restore` on it to find the last good state.
3. Compare the broken row with the same row on the branch to see what changed.
4. Rotate `DATABASE_URL` credentials in Neon and Vercel, and review who has database access.
5. Record what happened in the workspace (for example, as a note in the audit log via a comment on an
   approval) before restoring.

## Open items for the owner

- **Spotify Development Mode is for non-commercial use by individual developers.** Ensemble uses it
  for a private team tool with fewer than five users. Decide whether that fits, or apply for
  extended access when eligible.
- Optional: run the app with a database role that can't UPDATE/DELETE `audit_events` (README,
  deploy step 5).
- Optional: a WAF rate limit on `/api/auth/*` in Vercel Firewall, as a second layer.
