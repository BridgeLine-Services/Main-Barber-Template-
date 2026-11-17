# Rolling back a deployment

Rollback has two halves, code and schema. Doing only the first turns a bad deploy
into a bad week.

## The rule

The previous application version must still work against the new schema. That is
what `npm run deploy:migration-check` enforces in CI: it refuses destructive
statements in the newest migration unless that migration carries an explicit
`-- BREAKING: <reason>` marker. Additive migrations make rollback a click;
destructive ones make it an outage plus a restore.

## Which half do you need?

| Symptom | Code | Schema |
| --- | --- | --- |
| New UI or logic is wrong, database is fine | Yes | No |
| Migration ran and broke queries | Yes | Only if the migration was marked breaking |
| Data looks wrong after a deploy | No | No — restore instead (docs/DISASTER-RECOVERY.md §4) |

Never `prisma migrate reset`, never `db push`, never delete a migration record to
make a deploy pass. See `docs/MIGRATION-RECOVERY.md`.

## Roll back the code (Vercel, about 2 minutes)

1. Open the Vercel project for this shop.
2. Open the **Deployments** tab.
3. Find the last deployment known to be good. Its commit is the one `/api/health`
   reported before the bad deploy.
4. Click the **⋯** menu on the right of that row.
5. Choose **Promote to Production** (older dashboards call it **Rollback**).
6. Confirm. The alias moves back and nothing is rebuilt, so it is fast.
7. Open `/api/health` and confirm it now reports the older commit.

The database is not touched by this step.

## Roll back the schema (only for a migration marked breaking)

There is no automatic down-migration, deliberately: dropping a column destroys the
data a restore would have to recover.

1. Take a verified backup first: `npm run db:backup-verify` must print PASS.
2. Write the reverse change as a **new** migration (contract in reverse): re-add
   the old shape, backfill it, and drop the new shape in a later release.
3. Apply it to a staging copy with `npx prisma migrate deploy`, then run
   `npm run test:ci` there.
4. Apply to production only with the owner's explicit approval for that step.

## Verify the rollback

```bash
curl -s https://<shop-domain>/api/health         # serves the older commit
curl -s https://<shop-domain>/api/health/ready   # 200, ready
npm run db:backup:freshness                      # a recent verified backup exists
```

Then do the three things a shop depends on: book, cancel, sign in as the owner. If
any fails, stop rolling forward and restore instead.

## After an incident

Record the rolled-back commit, the serving commit, the reason and whether the
schema moved. Add the test that would have caught it in the same commit as the
fix. A rollback with no test after it is a rollback you will repeat.
