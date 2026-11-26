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

`vercel.json` must always equal one of those two files. It currently equals the **Hobby**
plan, because Hobby is the plan this deployment actually ships and Vercel rejects a Hobby
deployment whose cron configuration contains a sub-daily schedule. That rejection happens at
deploy time against the file itself, so an environment flag cannot suppress it: the only
lever is which plan file `vercel.json` contains.

## Switching plans

```bash
npm run cron:plan --check     # vercel.json must match CRON_PLAN, default hobby
npm run cron:plan:pro         # write the Pro schedule (includes the 15-minute job)
npm run cron:plan:hobby       # write the Hobby schedule (no sub-daily job)
```

`--check` is the drift guard: it fails if someone edits `vercel.json` by hand instead of
changing a plan file. An empty `CRON_PLAN` is treated as unset, so a blank value in a CI
environment resolves to the default rather than to an unknown plan name. CI runs
`npm run cron:plan --check` and `npm run test:cron-plan` before `test:ci`, so a Pro file
cannot reach a Hobby deployment unnoticed.

**Moving to Pro:** the deployment is currently Hobby, so the 15-minute job is implemented
but not scheduled. Nothing about the job is missing or stubbed: the route, the scheduler,
the idempotency key and the switch are all in place and tested. Activation is a
configuration change plus an environment change:

1. Upgrade the Vercel project to Pro (a billing decision, not a code change).
2. `npm run cron:plan:pro` — writes `vercel.json` from `config/vercel/crons.pro.json`.
3. `npm run cron:plan --check` with `CRON_PLAN=pro` — confirms the file matches the Pro plan.
4. `npm run test:cron-plan` — 41 assertions, including that the 15-minute entry survived.
5. Commit the `vercel.json` change and deploy.
6. Confirm Vercel lists `/api/cron/organization-report-delivery` as scheduled.
7. Set `ORGANIZATION_REPORT_CRON_ENABLED=true` in the Vercel environment.
8. Confirm `CRON_SECRET` is set. Without it the route refuses every call.
9. Trigger it once with the secret and confirm a `skipped: false` response and one report
   per due configuration, not two (the idempotency key is configuration + scheduled time).

Steps 2 to 5 are the whole code change. No scheduler code is rewritten.

The schedule and the switch are separate so the job can be deployed switched off and turned
on without a code change.

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
