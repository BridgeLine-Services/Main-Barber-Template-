# Scheduled jobs: the schedule and the switch

Two separate decisions, deliberately kept apart:

- **What the schedule is** lives in configuration files, version controlled.
- **Whether the job acts when called** lives in one environment variable.

Changing one must never silently change the other.

## The switch

`ORGANIZATION_REPORT_CRON_ENABLED`

| Value | Behaviour |
| --- | --- |
| `true` | The report route enqueues due reports and delivers them. |
| `false` | The route answers `200 { skipped: true }` and does nothing. |
| missing | Same as `false`. |
| anything else (`1`, `yes`, `TRUE please`) | Same as `false`. |

Only an explicit `true`, case-insensitive and trimmed, switches the job on. The value is read
on the server in `src/lib/cron-flags.ts`; nothing sends it to the browser, and no request can
turn the job on. When the job is on, `CRON_SECRET` is still required exactly as before: a
disabled job needs no secret because it does no work, and an enabled job refuses a wrong one.

Skipping is a success, not an error, so the platform does not retry a job that was
deliberately switched off.

## The schedule

The canonical Pro configuration is `config/vercel/crons.pro.json`:

```
/api/cron/organization-report-delivery    */15 * * * *
```

That exact schedule is the intended one and is preserved. It is not replaced by a daily job
anywhere.

`config/vercel/crons.hobby.json` is the Hobby-compatible alternative. It contains every other
job unchanged, and simply has no entry for the report job, because a plan that cannot run
sub-daily crons cannot run this one. Nothing is rewritten into a daily report: the job is
absent, not altered.

`vercel.json` must always equal one of those two files. It currently equals the Pro plan.

## Switching plans

```bash
npm run cron:plan --check     # vercel.json must match CRON_PLAN, default pro
npm run cron:plan:pro         # write the Pro schedule (includes the 15-minute job)
npm run cron:plan:hobby       # write the Hobby schedule (no sub-daily job)
```

`--check` is the drift guard: it fails if someone edits `vercel.json` by hand instead of
changing a plan file. To check against Hobby, set `CRON_PLAN=hobby`.

**Moving to Pro:** run `npm run cron:plan:pro`, commit the resulting `vercel.json`, deploy,
then set `ORGANIZATION_REPORT_CRON_ENABLED=true`. The schedule and the switch are separate so
that the job can be deployed switched off and turned on without a code change.

**Moving to Hobby:** run `npm run cron:plan:hobby`, commit, deploy, and leave the flag unset.

## Maintenance report

`/api/cron/maintenance-report` existed but was not scheduled. It is read-only (it builds a
report and writes nothing), so it now runs once a day at 10:00 in both plans. It is not
scheduled more often than daily and does not need its own switch.

## What the tests pin

`tests/cron-plan.test.ts` fails if:

- the Pro schedule is not `*/15 * * * *`,
- the Hobby plan contains any sub-daily schedule,
- the Hobby plan turns the report job into a daily one,
- `vercel.json` stops matching the selected plan,
- any scheduled path has no route,
- anything other than the report job runs more than once a day,
- the switch accepts anything other than an explicit `true`,
- the route checks the switch after starting work, or drops the secret check,
- report enqueuing loses its idempotency key.

## Idempotency

`src/lib/organization/scheduled-report.ts` enqueues with
`organizationReportIdempotencyKey(config.id, scheduledFor)`, so two cron invocations for the
same scheduled time cannot produce two reports. Retries are safe by construction.
