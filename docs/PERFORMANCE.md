# Performance notes

Code-level performance work done in the repository (Requirement 31).
No production benchmark has been run — nothing here claims one.

## Database indexes

The schema carries targeted composite indexes for the hot paths
(`Appointment`: `[businessId, startTime]`, `[barberId, startTime]`,
`[businessId, status]`, `[businessId, date]`; `Customer`:
`[businessId, phone]`; `AuditLog`: `[businessId, createdAt]`; etc.).
`scripts/rls-status.ts` and `docs/SCHEMA-INDEXES.md` document coverage.

## Fixes applied (each verified against actual consumer usage)

- `src/lib/rebooking-engine.ts` — `getRebookingTasks` ran a
  `findFirst` per customer plus a full intelligence lookup per customer
  (classic N+1). Now one batched `findMany` (distinct customerId)
  excludes customers with upcoming appointments BEFORE the expensive
  per-customer intelligence call.
- `src/lib/availability.ts` — `getEarliestAvailableSlot` fetched full
  `BarberService` rows when only `serviceId` is needed for the matching
  filter; now selects only that.
- `src/app/api/dashboard/appointments/route.ts` — the dashboard list
  returned FULL customer/barber/service rows and complete intake
  responses for every appointment. Now selects exactly the fields the
  dashboard renders (verified across AppointmentsListView,
  AppointmentDetailsDialog, calendar, barber-mode): customer contact
  fields, barber name/specialty, service name/price/duration, intake
  question/answer. Smaller payloads + data minimization.

## Already well-optimized (no changes needed)

- `src/lib/daily-operations.ts` — single batched `Promise.all` query set
  for the day view.
- `src/lib/availability.ts` — per-barber slot computation already
  parallelized with `Promise.all`.

## Automated check

`npx tsx scripts/perf-check.ts` scans application source for
sequential prisma awaits inside loops (the N+1 pattern). It currently
reports candidates in REVIEW mode (exit 0) because the heuristic also
flags deliberately bounded loops (per-notification status updates,
per-occurrence schedule checks). Triage the candidates, fix the
unbounded ones, allowlist the deliberate ones, then run with `--strict`
(`PERF_STRICT=1`) to enforce as a CI gate.
