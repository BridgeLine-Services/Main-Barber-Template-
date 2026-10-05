# Barber Time Clock

Per-barber clock in / clock out, unpaid breaks, owner corrections with a
full audit trail, configurable daily/weekly overtime, pay periods, and a
payroll-ready CSV export.

**Spec:** `spec/features/TIME-CLOCK-SPEC.md` · **Tests:**
`tests/time-clock.test.ts` (61 assertions, CI suite `npm run test:time-clock`)
plus database-level RLS coverage in `tests/rls-enforcement.test.ts`.

## Owner is the final authority

- A shop-level master switch (Dashboard → Time Clock → Settings) gates the
  whole feature. **OFF** hides all time clock UI and rejects every new clock
  or break punch server-side — a barber can never override it.
- Turning it OFF never deletes or hides history: entries, breaks, and the
  correction trail remain visible to the owner for payroll.
- The time clock produces **payroll-ready data only**. It never creates
  payroll payments and never touches scheduling, appointments, or services.

## Roles

| Capability | Owner | Barber |
| --- | --- | --- |
| Master switch, overtime rules, pay period | ✅ | ❌ (403 server-side) |
| Eligibility + team-view authorization | ✅ | ❌ |
| Live board (everyone's state) | ✅ | only if owner sets "Can view team records" |
| Hours report + CSV export | ✅ | same explicit grant, read-only |
| Correct entries (audit trail) | ✅ | ❌ |
| Clock in / out, breaks | — | ✅ (must be eligible, feature ON) |
| View own records | — | ✅ via `/dashboard/my-time-clock` and `GET /entries/[id]` |

Barbers **cannot view other barbers' hours unless the owner explicitly
authorizes it** (`canViewTeamRecords`, default OFF).

## Data model

- `TimeClockSettings` (per shop): `enabled`, `dailyOvertimeThresholdHours`,
  `weeklyOvertimeThresholdHours` (0 = rule disabled — thresholds are shop
  **data**, never hard-coded), `payPeriodType` (WEEKLY Mon–Sun / BIWEEKLY),
  `payPeriodAnchorDate`.
- `TimeClockEntry`: one row per shift (business + barber scoped). Open
  shift = `clockOutAt IS NULL`; hours keep accruing. A partial unique index
  guarantees one open shift per barber.
- `TimeClockBreak`: unpaid breaks; one open break per entry (partial unique
  index). Closed break minutes fold into `breakMinutes` and are deducted
  from worked hours.
- `TimeClockRevision`: immutable correction trail — one row per changed
  field with **original value, new value, who, when, and the reason**
  (reason required).
- `BarberTimeClockAccess` (per barber): `eligible`, `canViewTeamRecords`.
  Defaults when no row exists: eligible, no team view.

## Worked hours & overtime

`worked = clockOut − clockIn − closed break minutes` (open shifts accrue up
to "now"). Grouping by day/week uses the **shop timezone**; an overnight
shift belongs to its clock-in day for daily overtime.

- Daily OT: hours in one shop-tz day beyond the daily threshold.
- Weekly OT: hours beyond the weekly threshold that were **not already**
  counted as daily OT — `regular + daily OT + weekly OT = total` always.
  No double counting.
- Either rule can be disabled independently (threshold `0`).

Pay periods: WEEKLY (Mon–Sun in shop tz) or BIWEEKLY (anchored on
`payPeriodAnchorDate`). `today` / `week` / `payperiod` presets are all
timezone-safe.

## Owner corrections

PATCH `/api/dashboard/time-clock/entries/[id]` (owner-only): adjust clock
in / clock out / break minutes / notes. Validated: clock-out must be after
clock-in, and a reason is required. Each changed field appends a revision
row; nothing is overwritten or deleted.

## CSV export

`GET /api/dashboard/time-clock/export?preset=…&from=&to=&barberId=` —
one **closed** shift per row (open shifts excluded until closed):

```
Barber,Date,Clock In,Break Start,Break End,Clock Out,Regular Hours,Overtime Hours,Total Hours
```

Multi-break shifts export the first break start / last break end; all
closed break minutes are already deducted from the hour columns. Per-row
overtime uses the daily rule; weekly OT appears in dashboard aggregates.
Values containing commas are CSV-quoted.

## API surface (all businessId-scoped, server-authorized)

| Route | Who | What |
| --- | --- | --- |
| `GET/PATCH /api/dashboard/time-clock/settings` | Owner | master switch, OT rules, pay period |
| `GET/PATCH /api/dashboard/time-clock/access` | Owner | per-barber eligibility + team view |
| `POST /api/dashboard/time-clock/clock` `{action:'in'\|'out'}` | Barber (self) | punch; session barberId only |
| `POST /api/dashboard/time-clock/break` `{action:'start'\|'end'}` | Barber (self) | break transitions |
| `GET /api/dashboard/time-clock/my` | Barber | own state + today/week/pay-period hours |
| `GET /api/dashboard/time-clock/status` | Owner / authorized barber | live board |
| `GET /api/dashboard/time-clock/report` | Owner / authorized barber | per-barber hours + OT + totals |
| `GET /api/dashboard/time-clock/entries` | Owner | browse entries (filters, breaks, corrections) |
| `GET/PATCH /api/dashboard/time-clock/entries/[id]` | Owner (barber: own GET only) | detail / correction |
| `GET /api/dashboard/time-clock/export` | Owner | payroll-ready CSV |

Rejections: disabled feature → 400, ineligible barber → 403, duplicate
clock-in / clock-out-while-out / second simultaneous break / end-no-break
→ 409, cross-tenant id → 404.

## Audit trail

Owner decisions are audited in `AuditLog`: `TIME_CLOCK_ENABLED`,
`TIME_CLOCK_DISABLED`, `TIME_CLOCK_OVERTIME_RULES_UPDATED`,
`TIME_CLOCK_ACCESS_UPDATED`, `TIME_CLOCK_ENTRY_CORRECTED` (with field-level
original/new values and the reason). Punches are not duplicated into
AuditLog — the entries themselves are the record.

## Tenant isolation

All tables are businessId-scoped with database-level RLS policies
(`prisma/rls/production-rls.sql`), enforced in
`tests/rls-enforcement.test.ts`. Reports, status boards, corrections, and
CSV exports are always scoped to the caller's shop; cross-tenant entry ids
are rejected as not-found.
