# Backups and restore

Everything Ensemble keeps is in one Postgres database: accounts, the audit log, lyric versions,
evidence files and rights packages (`stored_files`), expenses and analytics. There's no separate
blob store to back up. So the Neon database's point-in-time restore (PITR) is the backup.

## What Neon gives you

- Neon keeps a write-ahead-log history for each project and can restore any branch to any moment
  inside the **restore window**. The window depends on the plan. Check it under
  *Project → Settings → Instant restore / History retention*, and set it to the longest your plan
  allows. A week is the practical minimum for this app, because a bad import or a mistaken revert
  is often noticed days later.
- A restore can create a **new branch** at a past time, leaving `main` untouched. Always restore
  that way first, verify the branch, and only then decide whether to point production at it.

## Monthly restore drill (10 minutes)

Do this once a month and after any schema migration that touches lyric or audit tables. Record each
drill in the table at the bottom.

1. In the Neon console, open the project → **Branches → Create branch**. Pick *Past point in time*
   and choose a moment about 24 hours ago. Name it `restore-check-YYYY-MM-DD`.
2. Copy the branch's **direct** (unpooled) connection string.
3. From a trusted machine with the repo checked out:
   ```bash
   DATABASE_URL='<branch URL>' pnpm verify:restore
   ```
   The script is read-only. It checks:
   - every migration in `db/migrations` is applied
   - the audit hash chain verifies end to end, and prints the head event and its time
   - every lyric version's `content_sha256` matches its text
   - every stored file (evidence, rights packages) matches its SHA-256
   - row counts for the main tables, and the time of the latest activity, which should be close to
     the moment you picked
4. All lines should say `PASS`. Compare the audit head time with the moment you restored to.
5. Delete the branch.

## Real incident: restoring production

1. Stop writes: in Vercel, turn on *Deployment Protection* for production, or roll back to a
   deployment that shows a maintenance page.
2. Create a restore branch at the last good moment (as above) and run `pnpm verify:restore` on it.
3. In Neon, use **Restore** on `main` from that branch (Neon keeps a backup branch of the
   pre-restore state). Alternatively, point `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in Vercel at
   the restore branch and redeploy.
4. Run `pnpm db:migrate` if the restored point predates a migration.
5. Sign in as an owner and open **Audit log**. The chain banner should say it verifies.
6. Anything written after the restore point is lost. The pre-restore backup branch still has it, so
   re-enter what matters by hand (with a note) rather than copying rows.

## Drill log

| Date | Restore point | Result | By |
| --- | --- | --- | --- |
| | | | |
