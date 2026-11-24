# Quiet days

An owner could already see who they can reach and who has drifted. They could not see which
day of their week is quiet, which is the question that decides what they do on a Monday
morning. This adds that one answer to the growth centre and nothing else.

## What it does

`/dashboard/growth` gains a **Quiet days** card. It reads the shop's own last eight weeks of
appointments, buckets them into shop-local days, and names the weekdays that book least.

Each finding states its own evidence, so the owner can check it rather than trust it:

> Across 4 Tuesdays you booked about 2 people a day, against 6 on an average day.

Then it says what to do, in the terms the shop already has: invite back the customers who
have not returned. No revenue is predicted, because this code cannot know it.

## The rules, and why each exists

| Rule | Reason |
| --- | --- |
| A weekday needs at least three occurrences before it is judged | Two Tuesdays is an accident, not a pattern |
| A day must be at most 70% of the shop's own average **and** at least one booking a day behind | Without the second test, a shop booking 0.4 a day everywhere would be told it has "quiet days" that are rounding noise |
| The comparison is always the shop against itself | No industry benchmark exists that this code could honestly know |
| A failed read is `could-not-check`, never zero and never "your week is even" | The worst outcome would be telling an owner their week is fine when the read simply failed |
| An empty book is `not-configured`, never healthy | There is nothing to compare, and saying "even" would be a guess |
| Days are bucketed in the shop's timezone, not the server's | An 11pm Pacific appointment belongs to that day in the shop, not the next day in UTC |
| Weekday names are a fixed list | A server locale must not be able to change what a day is called |
| No revenue, no promise, no technical vocabulary | The audience is a shop owner, not an analyst |

## Files

- `src/lib/growth/slow-days.ts` (new). Pure: it takes days, a timezone and a window, and
  returns a report. No database, no clock of its own, no organisation id.
- `src/app/(dashboard)/dashboard/growth/page.tsx` (modified). Loads the window, the
  appointment times and the business timezone inside the page's existing `safe()` pattern, so
  one failed read cannot blank the page, and renders the card in the existing card grid.
- `src/lib/growth/overview.ts` (modified). `'slow-days'` added to the card id union. The
  existing `buildGrowthCards` behaviour is untouched.
- `tests/slow-days.test.ts` (new). 77 assertions.
- `package.json`. `test:slow-days`, and the suite added to `test:ci`.

## Security

- The page is owner-only (`requireOwner`), and every read is scoped by `businessId` from the
  session. Nothing about the shop or the window comes from the request.
- No customer is named. The only customer-derived number is a count, and the page passes
  `dormantCustomers: null` because it has no verified count, so the action stays generic
  rather than guessing an audience size.
- The library cannot reach a database or take an organisation id, and a test pins that.

## Verified while building this

The commercial priorities matrix was inspected at `7ac8dd5` and is stale in more places than
the Phase 0 map recorded. Re-checked directly at `8c3f162`:

| Matrix claim | What is true |
| --- | --- |
| "Personal growth overview: not implemented" | `/dashboard/growth/performance` renders `buildBarberAnalytics`; an API route and four growth suites exist |
| "Tablet previews: not implemented, desktop and mobile only" | `AppearanceTab.tsx` has a three-way viewport with tablet at 768px and `aria-pressed` |
| "Utilisation: not found" | `src/lib/analytics/utilisation.ts` and `UtilisationSummary.tsx` exist and are wired into analytics |
| "Slow-day recommendations: none" | True, and this branch adds it |

## What remains

- The recommendation is not yet actionable in one click. A follow-up could deep-link the
  quiet-day offer into the existing campaign composer with the audience pre-resolved. That
  needs the composer's own audience rules, so it is a separate phase.
- No test runs this against a real database here. The query is scoped by `businessId` and
  covered by static checks, but a staging run is still the honest gate.
- Email and SMS delivery of a quiet-day offer remains out of scope, as it was for the
  announcement inbox.
