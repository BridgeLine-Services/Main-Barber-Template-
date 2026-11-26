# Type safety, measured

`tsconfig.json` has `strict` and `noImplicitAny` off. Switching them on in one change would be a
rewrite, so this records what each one costs today and what has actually been enabled.

## Measured on 2026-11-25 (baseline `f329135`)

Counts are `npx tsc --noEmit --<flag>` error counts across the repository, source and tests.

| Flag | Errors if enabled | State |
| --- | --- | --- |
| `noFallthroughCasesInSwitch` | 0 | **Enabled** |
| `strictFunctionTypes` | 0 | **Enabled** |
| `noImplicitReturns` | 6 | **Enabled** (the six were fixed first, see below) |
| `noImplicitAny` | 225 | Not enabled |
| `strictNullChecks` | 404 | Not enabled |

`strict` implies all of the above, so it stays off until `noImplicitAny` and `strictNullChecks`
are addressed in stages.

## What enabling `noImplicitReturns` actually found

Six paths, two of which were real inconsistencies rather than style:

1. `src/lib/notifications.ts` — `scheduleAppointmentReminders()` returned
   `{ scheduled, skipped, reason }` when email was misconfigured, and fell off the end of the
   function returning `undefined` when it was configured. A caller reading `.scheduled` got a
   crash or a wrong answer depending on the shop's email settings. It now returns the same shape
   on every path.
2. Four React effects (`audit-log/page.tsx`, `BeforeAfterSlider.tsx`, `RescheduleFlow.tsx`,
   `BusinessBasicsStep.tsx` twice) had a bare `return` on one branch and a cleanup function on
   another. These are now explicit `return undefined`, which is what React already received; the
   change is that the intent is written down.

Behaviour is otherwise unchanged: the notification suite passes 16/16 against a live server.

## The next stage, not done here

`noImplicitAny` (225) and then `strictNullChecks` (404). Both need to be worked per directory,
with the tests fixed before the flag moves on, and neither is safe to enable repository-wide in
a maintenance pass. Nothing here suppresses an error or adds `as any` to make a build pass.
