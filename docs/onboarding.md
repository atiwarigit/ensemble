# Onboarding

For the people using Ensemble (Romel, Nikki and anyone they invite). For setting up a deployment, see
the README.

## First sign-in

1. Open the invite link you were sent (it expires after 7 days) and choose a password.
   Romel and Nikki, if they were seeded, sign in with the initial password and change it in
   **Security**.
2. Owners and admins are asked to set up an authenticator app (1Password, Google Authenticator, …):
   scan the QR code, then type the 6-digit code. Keep the backup codes somewhere safe.
3. Ten wrong passwords in a row lock that email out for 15 minutes.

## Projects

A project is an artist, a release, or internal work. Projects are private: you see only the ones
you're on. Owners see all of them. On a project, a **lead** manages members and approves gated
changes, an **editor** adds and edits, and a **viewer** reads.

## Expenses

- **Add one:** Expenses → *Add expense*. Pick the project, or leave it personal.
- **Import a statement:** Expenses → *Import* → upload the bank or card CSV → check the column
  mapping → preview → *Import*. Re-importing the same file skips what's already there. Files over
  500 rows, and every revert, need a lead or owner to approve.
- **Budgets and reports:** Expenses → *Reports*. Generation costs (Suno, Kling, …) are a separate
  subtotal.

## Lyrics

- Lyrics → *New lyric*. Every save is a new version with a timestamp and a fingerprint (SHA-256).
  "Date written" is what you say. Ensemble proves when it *recorded* the text.
- Attach notebook photos or voice-memo files as evidence on the lyric page.
- Log AI generations (e.g. a Suno render) against the version they used.
- *Rights* shows the package. *Request finalization* sends it to a lead or owner. Once approved,
  the final package (PDF + ZIP) is ready to send to the PRO.

## Analytics

Spotify gives streams and listeners only to the artist team, in **Spotify for Artists** (S4A). There
is no API for those numbers, so Ensemble imports the CSVs you download. Separately, once an artist
is linked, a daily Spotify snapshot records the public catalogue (releases, tracks, ISRCs).

### Link the artist (once, project lead)

Analytics → the project → paste the artist's Spotify link (Share → Copy link to artist) → *Check* →
*Request link*. A workspace owner approves it in **Approvals**.

### Export from Spotify for Artists (weekly)

1. Go to [artists.spotify.com](https://artists.spotify.com) and pick the artist.
2. **Audience → Timeline** (or *Audience → Stats*, depending on the current layout): choose the range
   (*Last 28 days* or *Since 2015*), then the download icon → CSV. The file has `date` plus
   `listeners`, `streams` and `followers` columns.
3. Optional, per song: **Music → Songs** → pick a song → download its timeline. Its file has `date`
   and `streams`. When importing, choose *the whole file is one song*.
4. Optional, the Songs list: **Music → Songs** → download. It has no dates, so enter the last day of
   the period when importing.
5. Ensemble → Analytics → the project → *Spotify for Artists CSV* → *Upload and preview* → check the
   detected columns → *Import*. Days already imported are skipped.

If nothing is imported for 14 days, everyone on the project gets a reminder in **Notifications**.

### Alerts

On by default for every linked project. Leads can change thresholds on the analytics page.

- **Streams change:** streams over the last 7 days are up or down 50% against the 7 days before.
- **S4A data is stale:** no new export for 14 days.
- **Popularity change** and **follower milestone:** only when Spotify shares those figures with the
  app, which it doesn't for new apps (Development Mode).

## Chat

Chat → *Start chat* (pick a project or all projects). Ask in plain words, for example "what did we
spend in October and why did streams jump last week?". Without an AI provider, slash commands still
work: `/help`, `/expenses summary october`, `/budget`, `/lyric history "Title"`, `/streams`,
`/tracks`, `/why`. Analytics answers always say where a number came from and how current it is. When
explaining a change, they list what happened at the same time (releases, marketing spend) without
claiming it caused it.

## Approvals and the audit log

- **Approvals** lists requests waiting for you. Approving runs the change under your name.
- **Audit log** records every change and sign-in. It's tamper-evident (a hash chain), checked every
  night; owners are told if the check ever fails.

## Seed data (local and first deploy)

`pnpm db:seed` creates the workspace "dai + drm", Romel (owner) and Nikki (member) with
`SEED_PASSWORD`, default expense categories (including Marketing and Generation) and categorization
rules. It's safe to run twice. Sample files for trying things out:

- `samples/bank-csv/`: four bank and card statement shapes
- `samples/lyrics/`: a poem and a notebook-page photo
- `samples/s4a/`: an audience timeline, a song timeline and a Songs list for the mock artist Xania
