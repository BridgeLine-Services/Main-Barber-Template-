# Main Barber Template Architecture Constitution

**Status: governing architectural specification**
**Scope: the reusable Main Barber Template and every deployment copied from it**

## 1. Purpose

The Main Barber Template is a reusable, shop-agnostic application. A
barbershop is an independently configured instance of that application. This
constitution is the permanent contract for source code, data, deployment, and
AI-assisted changes. It is not optional guidance and must not be silently
weakened to fit a convenient implementation.

## 2. Permanent architectural principle

The source repository provides reusable application structure, functionality,
business logic, UI, authentication, booking, persistence, and security.
Shop-specific information is supplied through database records, environment
variables, deployment configuration, or authorized onboarding/administration
workflows.

### Zero source-code modification rule

Creating a new barbershop deployment MUST require **zero modifications to application source code for shop
configuration**. If a deployment requires
editing source to set its identity, branding, catalog, team, hours, policies,
booking rules, domain, or credentials, that is an architectural defect and
must be redesigned as reusable capability plus external configuration.

## 3. Canonical deployment workflow

```text
MAIN BARBER TEMPLATE → CREATE NEW REPO → VERCEL DEPLOY → CREATE DATABASE
→ ADD REQUIRED ENV VARS → REDEPLOY → CREATE OWNER ACCOUNT → SHOP ONBOARDING
→ BRANDING / SERVICES / BARBERS → BOOKING SETTINGS → TESTING
→ CUSTOM DOMAIN → CLIENT LAUNCH
```

This is the canonical lifecycle. Client configuration is entered through
onboarding/admin workflows and deployment settings, never by editing copied
source files.

## 4. Prohibited hard-coded configuration

Values that can reasonably differ between deployments must not be hard-coded
in application source. This includes business/shop names, logos and favicons,
colors and typography, descriptions, addresses, contacts, websites and
social links, hours and operating days, services (names, descriptions,
prices, durations and categories), barbers (names, profiles, photos,
schedules, availability and assignments), booking settings, duration/buffer
rules, cancellation/rescheduling/deposit/booking limits, customer-facing
policies, domains, production identifiers, credentials, API keys, database
credentials, and any other client-distinguishing value.

Moving a client value to `config.ts`, `constants.ts`, `settings.ts`,
`branding.ts`, or another source file does not make it configurable.
Generic labels, fallback copy for an unconfigured application, and genuine
application defaults are not client configuration.

## 5. Three information categories

* **Application code:** reusable components, pages, routes, persistence,
  authentication/authorization, booking, validation, security, error
  handling, and general behavior.
* **Shop-specific data/configuration:** identity, branding, catalog, team,
  schedules, hours, booking settings, policies, contact information, and
  customer-facing content. Store these in the database where appropriate and
  manage them through onboarding/admin workflows.
* **Deployment/environment configuration:** database URLs, auth secrets,
  API/email/payment/service credentials, deployment identifiers, domains, and
  infrastructure values. Use the hosting provider's environment-variable
  secret store. Secrets must never be committed.

## 6. Defaults

Generic defaults such as a default appointment duration are allowed only when
they describe application behavior and can be overridden by shop
configuration. A default must never identify a particular business or act as
disguised client configuration.

## 7. Database requirements

Operational shop data must be represented as database data rather than source
constants. The existing Prisma model uses `Business` as the tenant and links
branding, services, barbers, schedules, hours, policies, booking settings,
customers, and appointments to it. Preserve this architecture and its
tenant isolation. New entities or relationships must follow existing Prisma
conventions, include the appropriate tenant relationship, and be justified;
do not perform a blind database redesign.

## 8. Dynamic rendering and booking

Customer-facing and owner-facing interfaces must retrieve the current
business's configuration dynamically. The UI must not depend on client
constants. Services, prices, durations, barbers, schedules, hours, policies,
branding, and contact information must flow from the resolved tenant/database
or deployment configuration. Booking rules must be data-driven and must
respect the configured service, barber, schedule, availability, buffer,
cancellation, rescheduling, and booking-limit settings.

## 9. No client-specific forks

Do not add branches such as `shop === "..."` or `deployment === "..."` to
customize ordinary branding, services, barbers, hours, or booking settings.
Do not modify source after copying the template to configure a shop. A new
capability must be reusable and configurable for every future shop.

## 10. Testing and enforcement

Changes must retain tenant isolation and include focused tests for new
configuration behavior. The architecture checker (`npm run architecture:check`)
must pass. Architecture tests must prove that configuration is externalizable,
branding/services/barbers/booking settings have data representations, client
environment values are externalized, no secrets are committed, and a second
shop can use the same source with different data. Normal lint, typecheck,
tests, and build should also be run when practical.

The checker is intentionally conservative: it reports high-confidence
credentials, connection strings, API tokens, client-specific conditional
branches, and named client configuration in application source while allowing
generic terminology, placeholders, tests, documentation, and local defaults.
It is not a substitute for review or secret scanning.

## 11. Architectural violations and audit status

Violations are classified as `COMPLIANT`, `MINOR RISK`, `ARCHITECTURAL
VIOLATION`, `SECURITY VIOLATION`, or `UNKNOWN / REQUIRES REVIEW`. Safe
violations must be moved to data/environment configuration, with consumers,
tests, and checks updated. Risky migrations must not be partially attempted;
instead document the affected files, reason, and concrete remediation path.

Current audit: the Prisma tenant model and onboarding flows provide the
required external configuration boundary. Generic fallback copy and explicit
local/demo fixtures are application/test defaults, not client identity.
`next.config.mjs` contains a local development database fallback; it is not a
production credential, but deployments must always provide `DATABASE_URL`.
The checker reports future high-confidence violations. Manual review remains
required for content semantics and generated/demo fixtures.

## 12. Change control

Any intentional constitutional change must document the rule, reason, problem,
replacement mechanism, deployment impact, enforcement updates, and required
automated-check changes. In particular, the zero-source-modification rule may
not be removed or weakened because an implementation is inconvenient.

## 13. GitHub protection

The repository workflow runs on pull requests and pushes to `main` (and the
legacy repository branch names retained for compatibility). Repository
administrators must manually protect the primary `main` branch because branch
rules cannot safely be asserted from application source. In **Settings →
Branches → Branch protection rules** (or a repository ruleset), require a pull
request before merging, at least one approving review, dismissal of stale
approvals, conversation resolution, and the `Architecture Constitution /
Validate architecture constitution` status check. Require branches to be
up-to-date, restrict force pushes/deletions, and limit bypass actors. Also
protect this file and `.github/copilot-instructions.md` through the review
requirement. The current audit found no configured branch protection that this
workspace can claim to have enabled; administrators must verify and apply
these settings.

## 14. AI coding agent requirements

Before an architectural change, an AI agent MUST read this document, inspect
the relevant architecture, determine whether new values are shop-specific,
keep those values outside source, prefer reusable database/configuration
capabilities, avoid client forks and hard-coded client information, run the
architecture checker and normal checks, and report unresolved violations.
Temporary, client-only, or “refactor later” justifications do not permit a
violation. The repository instructions in `.github/copilot-instructions.md`
are mandatory companion rules.

## 15. Definition of done

The source remains reusable; a new deployment can follow the canonical
workflow without source edits; shop data is externalized and tenant-isolated;
secrets are externalized; dynamic interfaces and booking work; tests and
architecture checks pass; documentation and CI enforce this contract; and any
remaining risks are explicitly reported.

## 16. Final architectural contract

The source code remains the reusable application throughout the lifecycle.
The database, environment configuration, deployment, and domain change per
shop; application source code does not. This is the permanent architectural
principle of the Main Barber Template.
