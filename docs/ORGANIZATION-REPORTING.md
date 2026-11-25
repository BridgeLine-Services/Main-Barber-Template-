# Organization reporting and communications

## Scheduled aggregate reports

An organization owner or corporate admin with aggregate-report permission can configure a recurring summary from the organization overview. The schedule stores one email recipient, an IANA time zone, daily/weekly/monthly frequency, a 7/30/90-day reporting window, and an enabled state. Delivery runs at 9:00 AM local time (weekly on Monday, monthly on the first) and the cron checks due work every 15 minutes. The Vercel Cron endpoint fails closed unless `CRON_SECRET` is configured; it accepts only `Authorization: Bearer <CRON_SECRET>`. Email delivery also requires the existing email feature to be enabled with `EMAIL_ENABLED=true` and `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` configured. Without SMTP configuration, the worker records failure instead of marking a report as sent.

Scheduled reports use the existing `OrganizationReportingConfiguration` and notification queue. The queue claim is compare-and-set and each occurrence has a unique idempotency key. Transient email failures retry with bounded delays and permanently rejected deliveries are recorded as failed. The email includes organization-level totals only; it omits customer names, contact details, appointment histories, and profit estimates. The configuration shows the next run and last delivery outcome; queued messages are shown as awaiting delivery, not as sent. Transient failures show a retrying state, and changed schedules cancel unsent emails. Email is the only configured report channel; SMS is not offered.

The additive migration is `20261125120000_organization_report_scheduling`. It must be applied through the normal deployment process before scheduled-report settings are available. This change does not apply migrations to any database. Verify migration status independently in local, test, staging, and production first; production deployment of the migration requires explicit approval.

## Announcement audience decision

Named employee groups could make role-specific announcements easier to target, but the application has no persisted group definitions, membership lifecycle, or group-management permissions. A list of location IDs is not a safe substitute for a group of employees. No group model or group audience is being introduced without an approved membership design. The existing supported audience choices remain all open locations, a region, or a location; legacy group-shaped records are displayed generically and cannot be newly sent.

Announcements remain in-app only. Email and SMS announcement delivery are not enabled by this change; the inbox disclosure remains accurate. Scheduled aggregate report email is a separate, explicitly configured report feature.
