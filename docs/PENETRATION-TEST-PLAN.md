# Penetration test plan (Priority 4)

Scope, method and the specific things a tester should try. This is written so an external
tester can start without reading the codebase, and so the result is comparable between runs.

## Out of scope

- Denial of service and volumetric attacks.
- Social engineering of staff.
- Physical access.
- Third-party providers (Stripe, Twilio, the hosting platform) beyond how this application
  uses them.

## Environments

Test against **staging**, never production. Staging must run the same commit, the same
migration set and the same runtime role configuration as production. See
`docs/STAGING-ENVIRONMENT.md`.

## Priority 1: tenant isolation (the highest-value target)

| # | Test | Expected |
| --- | --- | --- |
| 1.1 | Sign in as shop A, request every `/api/dashboard/**` and `/api/**` endpoint with shop B's ids substituted in path, query and body. | No response contains shop B data. Ids from the request are ignored. |
| 1.2 | Repeat 1.1 with an organization member of organization X targeting organization Y. | `404` or `403`; never a partial result. |
| 1.3 | As a corporate role (`ORGANIZATION_OWNER`, `CORPORATE_ADMIN`, `REGIONAL_MANAGER`), request an individual customer record. | Refused. Corporate roles hold aggregate reporting only. |
| 1.4 | As a location manager, request a customer of another location in the same organization. | Refused. |
| 1.5 | Forge a referral code belonging to another shop and complete a booking. | The attribution is refused or ignored; no cross-shop attribution row. |
| 1.6 | Attempt to attach a second organization to a shop that already has one. | Rejected by the unique constraint on `OrganizationLocation.businessId`. |

## Priority 2: authentication and session

| # | Test | Expected |
| --- | --- | --- |
| 2.1 | Reuse a session cookie after "sign out of all devices". | Rejected; `sessionsValidAfter` invalidates it. |
| 2.2 | Replay a TOTP code within its window. | Rejected; the counter is stored. |
| 2.3 | Attempt password reset with a token for another account. | Rejected. |
| 2.4 | Enumerate accounts through login, register and reset responses. | Same shape and timing for known and unknown addresses. |
| 2.5 | Brute force the login and register endpoints. | Rate limited, with the limit visible in logs. |

## Priority 3: authorization inside one shop

| # | Test | Expected |
| --- | --- | --- |
| 3.1 | As a barber, call owner-only endpoints (`/api/dashboard/growth-stage`, payroll, commissions). | `403`. |
| 3.2 | As a barber, request another barber's analytics with `?barberId=`. | `403` unless owner or admin, and then only for a barber in the same shop. |
| 3.3 | As a staff member whose assignment has ended, use the location. | Access ends with the assignment. |

## Priority 4: payment and gift-card paths

| # | Test | Expected |
| --- | --- | --- |
| 4.1 | Replay a Stripe webhook. | Idempotency ledger rejects the duplicate. |
| 4.2 | Send a Stripe webhook with an invalid signature. | `400`; no state change. |
| 4.3 | Guess gift-card codes and check balances. | Rate limited; the code is never returned by the status endpoint. |
| 4.4 | Attempt a partial refund exceeding the original amount. | Rejected. |

## Priority 5: upload and rendering

| # | Test | Expected |
| --- | --- | --- |
| 5.1 | Upload a PHP or HTML file with an image `Content-Type`. | Rejected by magic-byte sniffing. |
| 5.2 | Upload an SVG containing `<script>` or an `onload` handler. | Stripped. |
| 5.3 | Set a barber photo to `javascript:` or `data:text/html`. | Not rendered. |
| 5.4 | Inject HTML through bio, service name and announcement body. | Escaped, never rendered as HTML. |

## Priority 6: database-level isolation (only if the runtime role is enabled)

| # | Test | Expected |
| --- | --- | --- |
| 6.1 | With `barber_app` as the runtime role, run the full suite. | Passes with no RLS policies applied. |
| 6.2 | After policies are applied, query a table without setting the tenant. | Zero rows, not an error and not another shop's rows. |
| 6.3 | Set `app.current_business_id` for shop A inside a transaction, then query shop B. | Zero rows. |
| 6.4 | Check `rolsuper` and `rolbypassrls` for `barber_app`. | Both false. |

## Deliverable

A report with, per test: pass or fail, the request that was sent, the response received, and
the severity of any failure. Failures in Priority 1 are treated as launch blockers.

## Fix and re-test

Every finding gets a regression test in `tests/` before it is closed, so the same gap cannot
reopen silently.
