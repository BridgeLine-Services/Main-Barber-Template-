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

---

# Second pass: owner navigation and a starting point on the dashboard

## Navigation (Part 4)

The owner sidebar kept its three sections (Overview, Website, System), because that
shape is what existing links, tests and habits are built on. What changed is the
grouping inside Overview, which was organised by nothing in particular.

The problem was concrete: Staff, Commissions, Payroll, Time Clock, Gift Cards,
Online Shop, Shop Orders and Analytics all lived under **System**. No shop owner
opens something called "System" to run payroll.

Where they live now:

| Group | What is in it |
| --- | --- |
| Appointments | Today at a Glance, Calendar, Appointments, Cancellations, No-Shows, Waitlist, Recurring, Closures |
| Customers | Customers, Reviews |
| Team | Barbers, Staff, Time Clock, Commissions, Payroll |
| Services and Stock | Services, Inventory |
| Business Growth | Marketing, Loyalty, Gift Cards, Online Shop, Shop Orders, Analytics |

System is now only what it says: Activity History, Security, Deactivate, Launch
Checklist, System Health.

**Proof that nothing was lost.** Before and after the change, every `href` in the
sidebar was extracted and sorted:

```
before=68 after=68
diff → no differences: identical set
```

So no route was dropped, added, or renamed. Only its parent group moved. The
barber navigation was not touched at all, and it still exposes no owner tools.

## Dashboard home (Part 5)

The dashboard showed today's appointments and nothing else, which answers "what is
happening" but not "what do I do next". A row of quick actions now sits under the
header for owners and co-owners only:

Appointments · Add a service · Add a barber · Set your hours · Customers · View your website

Each one is a plain link to a page that already exists, with a hover description of
what it is for. It adds a starting point, not a second workflow. Barbers do not see
it, because their surface is their own chair's day.

No statistics were invented. The counters on that screen still come from the same
queries they came from before.

## Verification for this pass

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully |
| `npm run test:ci` | exit 0 |
| `npx playwright test` (full) | 43 passed, 1 skipped, 0 failed |
| Sidebar link inventory | 68 before, 68 after, identical set |

One build failure during this pass was my own: I ran the build without
`NEXTAUTH_SECRET`, and `src/lib/auth.ts` correctly refuses to build in production
without it. Re-ran with the environment set and it compiled. Worth recording
because that guard is doing its job.

## Still not done from the directive

Unchanged from the list above, and not claimed anywhere as complete: onboarding
copy and step guidance (Part 6), splitting business setup from infrastructure
diagnostics on the launch checklist (Part 7), draft-versus-published explanations
throughout settings (Part 8), website management wording (Part 9), services and
scheduling help text (Part 10), customer journey copy (Part 11), a systematic
error-message audit (Part 12), responsive testing at tablet and mobile widths
(Part 13), and the human screen-reader assessment.

---

# Third pass: keeping infrastructure out of the owner's way

## Part 7 — the launch checklist was showing deployment diagnostics to shop owners

`/dashboard/setup` already does the business checklist properly, and in plain
language: Business ("your shop name, phone, address and time zone"), Branding,
Services, Team, Schedules, Booking and policies, Search and sharing, Launch review.

The problem was the page behind it. `/dashboard/factory-launch` — reachable from
the nav as Launch Checklist and from the setup checklist's own "Launch review" step
— rendered **every** check, including categories called Database, Domain, Security
and Tenant, with items such as "Authentication URL", "URL alignment", "Migration
status" and "Deployment binding". An owner following "a last look before you go
live" arrived at a list of things they cannot act on.

What changed:

- Infrastructure categories (Database, Domain, Security, Tenant) are now shown
  only to a `PLATFORM_OWNER`. A shop owner sees the business categories.
- The page's subtitle no longer reads like a deployment runbook. It now says that
  everything on the page is about their shop, and that site and server checks are
  handled for them.
- Two library labels lost their jargon: "Live acceptance test" became "Booking a
  real appointment yourself", and "Automated test suite" became "Our automated
  checks".

The checks themselves are untouched. Nothing was deleted, and the platform
operator still sees the full report. Only the audience changed.

## Part 6 — one honest promise removed from onboarding

`WelcomeStep` already told owners their progress is saved, which is true. It also
said "Takes about 2 minutes" for a seven-step wizard covering business details,
branding, services, team, hours and booking rules. That is a promise the product
cannot keep, and a new owner who runs past it learns not to trust the rest of the
copy.

It now reads: "Set aside a few minutes. There is no time limit, and you can stop
and come back whenever you like." Same reassurance, no invented duration.

## Verification for this pass

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully |
| `npm run test:ci` | exit 0 |
| `npx playwright test` (full) | 43 passed, 1 skipped, 0 failed |

## Honest position on Parts 8–22

Part 8 (draft versus published explanations) turned out to be largely present
already: publishing runs through `PublishWebsiteCard`, and the settings API's 403
already says "Draft saved — not live yet, an owner must publish". I did not add
another explanation on top of it.

Still not done, and not claimed anywhere: Part 9 website management wording,
Part 10 services and scheduling help text, Part 11 customer journey copy, Part 12
the systematic error-message audit, Part 13 responsive testing at tablet and mobile
widths, and the human screen-reader assessment.

---

# Fourth pass: Part 12 (error copy) and Part 13 (responsive behaviour)

## Part 12 — the audit found the API layer already clean, so I protected it

The directive assumed technical error text reaches owners. I checked before
changing anything, and it largely does not:

- 135 of 178 API routes return errors through `src/lib/api-errors.ts`.
- The 13 routes that return a raw `error.message` all do it inside an
  `instanceof SomeDomainError` branch, where the message was written for a person
  ("Consent withdrawn before delivery", "SMS notifications are not configured").
  Everything else falls through to the shared handler.
- That handler already maps driver codes to sentences rather than leaking them:
  `P2002` becomes "A record with that information already exists", `P1001` becomes
  "This service is temporarily unavailable. Please try again in a moment."
- The original grep for technical strings returned **0** matches.

So the useful Part 12 work was not editing messages, it was making sure this does
not drift. `tests/plain-language.test.ts` walks the source for string literals that
are the value of a key a person reads (`error:`, `message:`, `description:`,
`label:`, `title:`, `detail:`, `toast:`) and fails if one contains `Prisma`,
`ECONNREFUSED`, `P2002`, `P2025`, `P1001`, `TypeError`, `Cannot read properties`,
`Internal Server Error` and friends.

Deliberate exclusions, each for a real reason: `src/app/api/**` (covered by the
shared handler and its own tests), `src/lib/env-registry.ts` (developer
documentation for environment setup), `src/lib/notification-worker.ts` (failure
rows written to the database), and comments, because a comment that names a Prisma
code is a good comment.

Two iterations of the test itself were wrong before it was right, and that is worth
recording: the first version flagged `code === 'P2002'`, which is logic, not copy.
It now requires the banned word to appear inside a quoted value that is assigned to
a user-facing key. Result: 3 passed, 0 failed, wired into `npm run test:ci`.

## Part 13 — responsive behaviour, measured rather than assumed

There was no responsive test at all. `e2e/responsive.spec.ts` now loads real pages
at **phone (390x844)** and **tablet (768x1024)** and compares
`documentElement.scrollWidth` against `clientWidth`. Tolerance is 2px, because
sub-pixel rounding in a flex row is not a defect, while a table hanging 40px off
the edge is.

Covered: 4 public routes (`/`, `/barbers`, `/gallery`, `/book`) and 8 owner
dashboard routes (home, appointments, calendar, customers, services, barbers,
analytics, branding settings) at both widths, plus a check that the `main` region
itself does not exceed the viewport.

Result: **24 of 24 pass**. Nothing overflows sideways at either width today. That is
worth having as a fact and as a tripwire, not as a claim that every screen has been
eyeballed on a device.

## Verification for this pass

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully |
| `npm run test:ci` (now 44 suites incl. plain-language) | exit 0, plain-language 3/3 |
| `npx playwright test` (full) | 67 passed, 1 skipped, 0 failed |

## Where this leaves the directive

Done: Part 3 (wording), Part 4 (owner navigation grouped by job), Part 5 (quick
actions on the dashboard), Part 6 (honest onboarding promise), Part 7 (infrastructure
hidden from owners), Part 8 (verified already correct), Part 12 (audit plus guard),
Part 13 (responsive regression at two widths).

Not done, and not claimed: Part 9 website management wording, Part 10 services and
scheduling help text, Part 11 customer journey copy, Parts 14-22 (which I have not
been able to read from the truncated directive, so I will not guess at them), and
the human screen-reader assessment, which needs a person with a screen reader rather
than a script.

---

# Fifth pass: Parts 9, 10 and 11

## Part 9 — website management was already right, so I verified instead of rewriting

The two places an owner meets their website both already say the right thing:

- `PublishWebsiteCard`: "One click: **Save Changes** saves your edits and makes them
  live on…", with a status line that distinguishes "Never published" from
  "Unpublished draft changes".
- The preview page carries a banner when it is not embedded in a settings iframe:
  "DRAFT PREVIEW — only visible to signed-in staff. This is exactly what your
  homepage will show once you press Publish website in Settings."

I checked the banner actually renders rather than trusting the comment above it that
claimed it did. It does, behind `{!embedded && …}`. Adding a second explanation on
top of working copy would make the screen worse, so I left it.

## Part 10 — services, described by what they do

- The page title was "Service Catalog". It is now "Services", with a line that says
  what the screen is for: "Everything you sell. Each service sets what a customer
  pays and how long it holds the chair, which is how your online booking knows what
  to offer."
- The empty state was "No services found. Click 'Add Service' to create your first
  offering." It now names the usual first step and the consequence: add a haircut
  and it becomes bookable on the website straight away.
- Column headers "Duration" and "Actions" became "Time needed" and "What you can do".
- The form field "Duration (Minutes) *" is now "How long it takes (minutes)" with
  help text: count everything, the cut, the conversation and the tidy-up, because
  booking uses this to work out which slots to offer. Its validation error likewise
  stopped reciting a rule and started giving an example: "Enter how long this takes,
  for example 30 minutes."

## Part 11 — the customer journey's dead ends

Two customer pages greeted visitors with **"Shop Not Configured"** and "An
administrator needs to run the setup process." That is a developer's status message
shown to someone trying to book a haircut.

- `/services` now says "Our services are not online yet", and explains what to do:
  the shop is still getting set up, contact it directly in the meantime.
- `/accessibility` now says "This page is not ready yet" with the same guidance.
- Cancelling online said "Failed to cancel. Please try again or call the shop." It
  now reads "We could not cancel this appointment just now. Please try again in a
  moment, or call the shop and they will do it for you."

## Verification for this pass

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run build` | compiled successfully |
| `npm run test:ci` | exit 0 |
| `npx playwright test` (full) | 67 passed, 1 skipped, 0 failed |

## Parts 14 to 22 were never in my hands

I do not have the text of Parts 14 through 22. It is not in this conversation's
context, not in the workspace, and not in the repository, so I did not guess at nine
parts of work and then report them as done. Send those part numbers again and they
are next.
