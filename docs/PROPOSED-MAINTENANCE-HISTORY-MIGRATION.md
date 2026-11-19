# Proposed maintenance history: review package (NOT APPLIED)

**Status: proposed only.** No migration file exists, no model exists, nothing has been
applied to any database. Part 5.3 of the directive authorises an additive migration; your
instruction is that you review it first. This document is that review.

Repository: `main` at `2b65ab3`. Date: 2026-11-18.

## 1. Why it is needed

The Reliability Center says what is wrong. It cannot say what was done about it, by whom,
or whether a repair was approved. Without that, an owner has no history and a future
maintainer has no audit trail.

## 2. Why existing models are not reused

`BackupRun` records backup history only. `AuditLog` records user and security events.
Neither is a maintenance record: an approval has two parties, a proposed change and an
outcome. Overloading either would corrupt its meaning, which the directive also says.

## 3. Proposed model (additive)

```prisma
model MaintenanceAction {
  id             String    @id @default(cuid())
  actionKey      String
  /// 'automatic' | 'approval' | 'manual' - the monitor's existing RepairClass.
  repairClass    String
  component      String
  /// Null means platform-wide and requires separate authority.
  businessId     String?
  business       Business? @relation(fields: [businessId], references: [id], onDelete: Cascade)
  previousValue  String?
  proposedValue  String?
  requestedById  String?
  approvedById   String?
  approvalState  String    @default("proposed")
  executionState String    @default("not-started")
  /// Sanitised outcome sentence. Never a secret.
  result         String?
  rollbackRef    String?
  createdAt      DateTime  @default(now())
  approvedAt     DateTime?
  startedAt      DateTime?
  completedAt    DateTime?

  @@index([businessId, createdAt])
  @@index([approvalState, createdAt])
}
```

Nothing existing is renamed, dropped or altered. The only edit to an existing model is one
nullable back-relation field on `Business`, which Prisma requires.

## 4. Migration draft (not created)

One additive migration, `20261118120000_maintenance_action`, containing only `CREATE
TABLE`, `CREATE INDEX` and `ADD FOREIGN KEY`. No `DROP`, no `ALTER COLUMN`, no data
statement. If any of those appear in the final SQL, stop the review.

## 5. Tenant and platform scoping

Business rows are readable only by that business's owner and co-owners, through the same
server-side pattern as every other dashboard query. `businessId IS NULL` rows are
platform-wide, invisible to every shop, written and read only by an explicitly authorised
path, and the read is logged. The policy file is written with the model and **not applied**
by this migration.

## 6. What it must never contain

No connection strings, tokens, passwords, customer records or provider responses. A test
fails the build if a seeded `result` matches a credential shape.

## 7. Rollback

`DROP TABLE "MaintenanceAction"` returns the database to its present state, because no
existing table was modified. Only maintenance history is lost, which is not business data.

## 8. Test plan before it is applied anywhere

1. `npx prisma validate`.
2. Apply to a disposable database only.
3. Assert the table, both indexes and the foreign key exist.
4. Assert an existing business, its services, barbers and appointments are unchanged.
5. Assert a shop cannot read another shop's rows or any platform row.
6. Assert the automatic class can never carry a major-upgrade payload.
7. Assert the credential-shape test refuses a secret in `result`.
8. Run the full suite and the 42 RLS checks.

## 9. Decision requested

Approve, change or reject. On approval the work is the model, one additive migration, the
unapplied policy file, the approval flow and these tests. **No production database is
touched by any of it**; applying it to production stays a separate later step.
