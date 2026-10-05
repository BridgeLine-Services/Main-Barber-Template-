# Payroll-Ready Reporting

Per-barber period reports that combine time clock hours, completed-service
revenue, tips, commissions, and adjustments into one payroll-ready
snapshot with a CSV export — for the owner to hand to their **actual
payroll provider**.

**This is NOT a payroll processor.** It never pays anyone, never withholds
taxes, and never becomes a payroll provider: it organizes payroll-ready
information only.

**Tests:** `tests/payroll.test.ts` (80 assertions, CI suite
`npm run test:payroll`) plus database-level RLS coverage in
`prisma/rls/production-rls.sql` and `scripts/rls-status.ts`.

## Owner is the final authority

- A shop-level master switch (Dashboard → Payroll → Feature settings) gates
  the whole feature. **OFF** hides all payroll reporting and blocks report
  generation server-side.
- Turning it OFF never deletes history: every generated report row stays in
  the database and reappears when the owner turns reporting back on.
- Appointments, payments, commissions, and the time clock keep working
  independently whether payroll reporting is ON or OFF.

## Roles

| Capability | Owner | Barber |
| --- | --- | --- |
| Master switch, pay period, self-view grant | ✅ | ❌ (403 server-side) |
| Generate / review / export / finalize reports | ✅ | ❌ |
| Manual adjustments (audit trail) | ✅ | ❌ |
| View own summaries | — | only if owner enables `barberSelfView` |

Barbers **never see other barbers' wages or hours, and never see shop
payroll totals** — the self-view endpoint scopes to the session's
`barberId` server-side, so the grant cannot be widened by the client.

## Pay periods (shop timezone)

Owner-configured in settings — thresholds and periods are shop **data**,
never hard-coded:

- **WEEKLY** — Monday-based week
- **BIWEEKLY** — two-week periods counting forward from the anchor Monday
- **MONTHLY** — calendar month in the shop timezone
- **CUSTOM** — owner-defined length in days (1–365)

An explicit custom range (1–400 days) can also be given per report.
Period boundaries are computed in the shop timezone so a 22:00–02:00
shift lands in the right period.

## Report lifecycle

```
DRAFT ──▶ REVIEWED ──▶ EXPORTED ──▶ FINALIZED
   └──────────┴──────────────▶ FINALIZED (direct finalization allowed)
```

- Forward-only. Backwards or repeated transitions are rejected.
- A report is an **immutable snapshot**: `PayrollReportLine` freezes
  service revenue, tips, commission, adjustments, and hours at generation
  time. Later payments, refunds, or commission changes never rewrite a
  stored line.
- **Finalization locks the snapshot.** The only way to change a finalized
  report's effective numbers is a `PayrollReportAdjustment` — an
  append-only audit row (amount, required reason, author, timestamp).
  Adjustments apply on top of the frozen values; finalized data itself
  is never modified, so the history stays provable.

## What a report aggregates per barber

| Column | Source |
| --- | --- |
| Service Revenue | settled `CHARGE` payments, net of refunds (pending/failed excluded) |
| Tips | settled `TIP` payments, net of refunds |
| Commission | commission ledger entries (all sources) |
| Adjustments | ledger manual + refund adjustments at generation, plus post-generation payroll adjustments |
| Regular / Overtime / Total hours | closed time-clock shifts under the shop's overtime rules (open shifts excluded until closed) |
| Estimated Payout | commission + adjustments + tips owned by the barber |

Tips are never double-paid: under the shop's tips mode `EXCLUDED`
(default) tips are the barber's own and count toward the payout; under
`PASS_THROUGH`/`PERCENT` tips already flow through the commission ledger
and are not counted again.

## CSV export

`GET /api/dashboard/payroll/reports/[id]/export` — one row per barber with
effective values, plus a TOTAL row. Header (fixed):

```
Barber,Pay Period,Regular Hours,Overtime Hours,Service Revenue,Tips,Commission,Adjustments,Estimated Payout
```

Exporting moves a DRAFT/REVIEWED report to EXPORTED and writes an audit
log entry; FINALIZED reports re-export freely.

## API

| Endpoint | Method | Who |
| --- | --- | --- |
| `/api/dashboard/payroll/settings` | GET / PATCH | Owner |
| `/api/dashboard/payroll/reports` | GET / POST (generate) | Owner |
| `/api/dashboard/payroll/reports/[id]` | GET | Owner |
| `/api/dashboard/payroll/reports/[id]/status` | POST | Owner |
| `/api/dashboard/payroll/reports/[id]/export` | GET (CSV) | Owner |
| `/api/dashboard/payroll/reports/[id]/adjustments` | POST | Owner |
| `/api/dashboard/payroll/my` | GET | Barber (self-view grant) |

Pages: `/dashboard/payroll` (owner), `/dashboard/my-payroll` (barber
self-view, quiet "not available" state when the grant is off).

## Audit trail

`PAYROLL_REPORTING_ENABLED`, `PAYROLL_REPORTING_DISABLED`,
`PAYROLL_SETTINGS_UPDATED`, `PAYROLL_REPORT_CREATED`,
`PAYROLL_REPORT_STATUS_CHANGED`, `PAYROLL_REPORT_EXPORTED`,
`PAYROLL_REPORT_ADJUSTMENT` — every state change lands in the shop's
audit log with before/after values.

## Tenant isolation

All payroll tables (`PayrollSettings`, `PayrollReport`,
`PayrollReportLine`, `PayrollReportAdjustment`) carry `businessId` and
are covered by the Postgres RLS `tenant_isolation` policy; every query
in the lib/API is businessId-scoped. Cross-shop report reads and
cross-shop line leakage are covered by tests.
