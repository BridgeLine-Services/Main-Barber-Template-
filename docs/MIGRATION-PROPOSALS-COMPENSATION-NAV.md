# Compensation models and custom navigation: proposals awaiting owner approval

## Status: APPROVED AND APPLIED TO THE SCHEMA (2026-11-18)

The owner approved both proposals on 2026-11-18. The change now exists as migration
`20261118220000_compensation_models_and_navigation`, applied and verified on a disposable
database (`prisma migrate deploy` from empty, then `prisma migrate diff` reported no
difference between schema and database). **It has not been applied to production.** That
stays an owner action, and it is additive, so it can run on a live database without
touching a single existing row.

Three questions in this document remain unanswered, and the code refuses to guess at them
rather than inventing payroll policy:

- A monthly rent inside a weekly pay period returns UNKNOWN, not a prorated figure.
- Hours worked must be supplied by the caller. Nothing infers them from appointments,
  because a barber standing in an empty shop is still working, and no clock-in model exists.
- A hybrid threshold is optional; null means commission on all service revenue.

Two items from the commercial priorities cannot be built as code alone, because both need
somewhere to store an owner's decision. Each is written here with the smallest change that
does the job, and what happens if the owner says no.

---

## 1. Hourly, booth-rental and hybrid compensation

### Why code alone cannot do it

`Barber.commissionRate` is a single `Float?`. It answers one question: what percentage of
service revenue does this barber earn. The three missing models ask different questions:

- **Hourly** pays for hours worked, regardless of what was sold.
- **Booth rental** is the reverse: the barber pays the shop a fixed rent per period, and
  keeps their service revenue.
- **Hybrid** combines a base (hourly or rent) with a commission on top.

A single float cannot express any of those without the arithmetic inventing meaning. That
is why the work stopped here rather than guessing at a number.

### Proposed change

One enum and three nullable columns on `Barber`. All additive, all defaulted, so existing
rows keep behaving exactly as they do today.

```prisma
enum CompensationModel {
  COMMISSION   // today's behaviour; the default for every existing barber
  HOURLY
  BOOTH_RENTAL
  HYBRID
}

model Barber {
  // ...existing fields unchanged...
  compensationModel   CompensationModel @default(COMMISSION)
  hourlyRate          Float?   // HOURLY and HYBRID base, per hour
  boothRentAmount     Float?   // BOOTH_RENTAL and HYBRID base, per period
  boothRentPeriod     String?  // "WEEKLY" | "MONTHLY"; null = WEEKLY
}
```

### The arithmetic, stated before it is coded

These are the rules the code would implement, written so they can be argued with now:

1. `COMMISSION` is unchanged. Existing payouts must not move by a cent.
2. `HOURLY` pay = hours actually worked in the period, taken from the schedule and
   attendance records, multiplied by `hourlyRate`. Hours are never inferred from
   appointments, because a barber standing in an empty shop is still working.
3. `BOOTH_RENTAL` pay = service revenue minus `boothRentAmount`. If rent exceeds revenue the
   result is negative, and it is reported as money owed rather than silently floored at zero.
4. `HYBRID` pay = base (hours × rate, or rent) plus commission on service revenue above a
   threshold the owner sets. The threshold is not guessed here; it needs a value.
5. A missing rate on a model that requires it makes the payout **unknown**, not zero. The
   payroll screen would say so, in the same plain language used elsewhere.

### What still needs an answer from the owner

- Which period the rent is charged over, and whether rent is prorated for a part period.
- Whether hybrid commission applies to all revenue or only above a threshold.
- Whether hours come from the published schedule or from clock-in records, which do not
  currently exist as a model.

Until those are answered, implementing this would be inventing payroll policy.

---

## 2. Custom navigation for the public site

### Why code alone cannot do it

The site's navigation is currently derived from which sections are enabled. An owner who
wants to rename a link, reorder two of them, or hide one without disabling its section has
nowhere to put that decision. The `WebsiteContent` model stores content, not structure.

### Proposed change

One nullable JSON column, additive:

```prisma
model WebsiteContent {
  // ...existing fields unchanged...
  navigation Json?  // [{ label: "Prices", href: "/services", visible: true }]
}
```

`null` means "derive from the enabled sections", which is exactly today's behaviour, so
every existing site keeps working with no backfill. A stored array is validated on save:
at most 8 items, labels 1 to 24 characters, and `href` restricted to same-site paths that
begin with `/` so a navigation entry cannot become an open redirect.

### What still needs an answer from the owner

Whether navigation items should be able to point at pages outside the site at all. The
proposal says no, because a shop's menu pointing off-site is usually a mistake or a
compromise, and refusing it removes a class of phishing risk.

---

## 3. Items still blocked for other reasons

- **Referral rewards** need a ledger with duplicate-redemption protection. Not proposed
  here because it is the largest of the schema changes and deserves its own review.
- **Birthday segmentation** needs a date-of-birth field on the customer model, which is
  personal data and needs the owner's decision on retention.
- **Published version history** needs a snapshot table. The `publishedContent` column holds
  one version today; history means keeping many, which is a retention decision.
- **TikTok** needs a social link field, trivial in code, but the same field family as the
  existing Instagram and Facebook links, so it belongs in the same review.
- **Video** needs a decision on where files live. Uploading video to the app's own storage
  would be the largest cost line in the project, so it is an owner decision, not a coding
  one.

---

## How to approve

Reply with which of the two proposals to apply. On approval, each lands as its own commit
with its own migration, its own test suite, and a rollback note. Nothing is applied to a
production database without that reply.

---

## Rollback

If this migration must be undone, run this by hand against the database it was applied to.
It is destructive to the new columns only, and nothing existing is touched:

```sql
ALTER TABLE "WebsiteContent" DROP COLUMN "navigation";
ALTER TABLE "Barber"
  DROP COLUMN "compensationModel",
  DROP COLUMN "hourlyRate",
  DROP COLUMN "boothRentAmount",
  DROP COLUMN "boothRentPeriod";
DROP TYPE "CompensationModel";
```

Dropping the columns discards any saved menu and any compensation settings, so export the
`Barber` compensation columns and `WebsiteContent.navigation` first if they hold real values.
The application keeps working either way: a missing column reads as null, and null means
"derive from the sections" for navigation and COMMISSION for pay.
