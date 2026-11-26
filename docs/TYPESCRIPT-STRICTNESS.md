# TypeScript strictness: measured, not asserted

`strict` is still `false`. That is a fact, not a plan. What follows is measured on this
repository at the commit that added this file, so the gap is a number rather than an opinion.

## The measurement

Each flag was turned on alone with `npx tsc --noEmit --<flag>` and the `error TS` lines counted.

| Flag | Errors if enabled today | Decision |
| --- | --- | --- |
| `strictNullChecks` | 384 | Deferred. The largest and most valuable one; see the order below. |
| `noImplicitAny` | 228 | Deferred. |
| `useUnknownInCatchVariables` | 89 | Deferred. |
| `strictFunctionTypes` | 0 | Already enabled. |
| `noImplicitOverride` | 0 | **Enabled.** |
| `noFallthroughCasesInSwitch` | 0 | **Enabled.** |
| `noUncheckedIndexedAccess` | 0 | **Enabled.** |

The three newly enabled flags cost nothing today and prevent whole classes of bug
(`noUncheckedIndexedAccess` alone stops an array read returning `undefined` silently,
`noFallthroughCasesInSwitch` stops a missing `break`, `noImplicitOverride` stops a method
that silently stops overriding).

## The order for the rest

1. `useUnknownInCatchVariables` (89) in `src/lib/**` first. Every one of those is a catch
   block that assumes an error shape; the fix is the `toErrorMessage` helper that already
   exists, so the work is mechanical and the reward is that a thrown string stops being
   silently trusted.
2. `noImplicitAny` (228) in `src/lib/**`, then in route handlers. Most are callback
   parameters in `.map`/`.filter` chains.
3. `strictNullChecks` (384) last, because it is the one that changes behaviour at runtime if
   the fix is wrong. Do it per directory, starting with `src/lib`, with the full suite run
   after each directory.

Enabling `strict: true` in one commit would need a 700-line diff with no test proving it is
correct. Doing it in that order keeps every step reviewable and reversible.

## What is not claimed

`strict` remains `false`. No file in this repository is described as strict-safe beyond the
four flags above. Section 16 of the brief is therefore **partly done**, and this document is
the honest measure of how far.

## A strict gate that already runs

`tsconfig.strict.json` compiles the highest-risk modules with `strict: true`, and
`npm run typecheck` now runs it after the normal check, so the gate is enforced rather than
aspirational. It covers the tenant helper, the cron switch, the website version and
navigation rules, the brand contrast audit, and birthday segmentation: code that decides
who can see what and what a customer is told.

Two real defects surfaced the moment it was switched on, both null-handling mistakes that
the loose configuration had been hiding (a parsed month name that could be `undefined`, and
a removed navigation item that could be `undefined`). Both are fixed properly, not cast away.

Growing the gate is deliberate: add a module to `include`, run `npm run typecheck:strict`,
fix what it finds, keep it green.
