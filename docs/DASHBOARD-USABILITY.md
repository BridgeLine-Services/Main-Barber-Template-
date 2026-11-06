# Dashboard usability pass: baseline and first slice

Branch `feat/non-technical-business-dashboard`, based on `origin/main` at `cb2848f`
(merge of PR #80). Previous work from earlier rounds is already on `main` through
PRs #76 and #80, so this branch starts from the merged baseline rather than a side
branch.

## Baseline recorded before any change

| Fact | Value |
| --- | --- |
| Base commit | `cb2848f` on `origin/main` |
| Pages | 88 `page.tsx` routes |
| API routes | 178 `route.ts` handlers |
| Public tables | 67 (57 migrations) |
| Env contract | 79 declared, 70 referenced, 0 drift |
| Feature keys | 20, all consulted server-side, all 20 in the enforcement contract |
| `npm run test:ci` | exit 0 |
| `npx playwright test` | 43 passed, 1 skipped, 0 flaky |
| `npm run typecheck` | clean |
| `npm run architecture:check` | passed, 600 files |

Known blocker unchanged from earlier rounds: staging acceptance and real provider
integrations still need credentials (Upstash, Neon, Stripe test keys, Twilio, SMTP,
a 32+ character signing secret). Nothing in this pass depends on them.

## What this pass changed

Only the wording of labels a business owner reads. No route, permission, query
parameter, API shape, schema field or publishing behaviour was touched.

| Where | Before | After |
| --- | --- | --- |
| Sidebar (System) | Launch Console | Launch Checklist |
| Sidebar (System) | Factory Status | System Health |
| Sidebar (System) | Audit Log | Activity History |
| Sidebar (Overview → Today) | Daily Ops | Today at a Glance |
| Sidebar (Website → Branding) | Layout & Behavior | Page Layout |
| Sidebar (Website → Branding) | Dashboard Preview | Screen Preview |
| Sidebar (Website → Shop Gallery) | OG Image | Share Preview Image |
| Launch page heading | Factory Launch Console | Launch Checklist |
| Health page heading | Factory status | System health |
| Health page eyebrow | Barber Website Factory | System |
| Health page status | `READY` / `FAILED` | Ready to launch / Needs attention |
| Health page counts | "2 passed, 1 failed, 3 warnings" | "2 checks passed, 1 needs attention, 3 optional features are switched off" |
| Activity page heading | Audit Log | Activity History |
| Share image page title | OG Image | Share Preview Image |
| Media library type label | OG Image | Share Preview Image |
| Settings tab title | Layout & Behavior | Page Layout |

URLs are unchanged, so every existing deep link, bookmark and query-string tab
still resolves exactly as before. Only the visible names moved.

### Why these and not more

"Factory", "Launch Console", "OG Image" and "Layout & Behavior" name internal
concepts. An owner running a barbershop has no reason to know any of them. The
health page in particular reported `READY` and "3 warnings" with no explanation,
which reads as a technical audit rather than a checklist.

Two deliberate non-changes:

- **Barber Mode** keeps its name. It is explained in the page itself ("a barber
  sees their own chair's day"), and a barber is the audience.
- **Tenant** and **snapshot** appear only in source comments, never in the
  interface, so renaming them would churn code for no user benefit.

### Test change, stated plainly

`e2e/nav-active-state.spec.ts` asserted the literal label "Dashboard Preview".
The label was deliberately renamed, so the expectation now says "Screen Preview".
The assertion itself is unchanged in strength: same link, same `aria-current`
check, same tab it opens. No assertion was removed or loosened.

## Verification for this pass

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully |
| `npm run test:ci` | exit 0 |
| `e2e/nav-active-state.spec.ts` | 6 passed, 1 skipped |
| `dashboard-smoke`, `accessibility`, `security` | included in a 34-test run, 33 passed, 1 skipped, 1 fixed expectation |

## What this pass did NOT do

The directive covers far more than wording. Being explicit about what is still
outstanding is part of the assignment, so:

1. **Part 4, navigation restructure into My Shop / Appointments / Customers /
   Team / Services / Website / Business Growth / Settings.** Not done. The
   current three-section shape (Overview, Website, System) with groups inside it
   is the structure the owner has been using, and reshaping it is the kind of
   change that breaks muscle memory and deep links if rushed. The label work
   above is the safe first slice.
2. **Part 5, dashboard home.** Not inspected in enough depth to change. The
   dashboard already reads real data; no invented statistics were added because
   none were added at all.
3. **Part 6, onboarding copy and step guidance.** Untouched.
4. **Part 7, setup checklist items and statuses.** `src/lib/factory-launch.ts`
   and the readiness report were left functionally as they are; only the page
   wording changed.
5. **Part 8, settings explanations of draft versus published.** Untouched.
6. **Parts 9-13.** Website management, services/barbers/scheduling, customer
   journey, error handling audit, and responsive work are untouched.
7. **Part 13, human screen-reader assessment.** Still outstanding, as it has been
   in every previous round.

None of that is claimed as done, and no documentation elsewhere claims it is.
