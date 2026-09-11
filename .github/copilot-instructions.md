# Repository architecture instructions

The canonical architectural authority for this repository is:

`docs/ARCHITECTURE_CONSTITUTION.md`

Read and obey it before making architectural changes. The Main Barber
Template is shop-agnostic: client-specific configuration must not be
hard-coded, and creating a deployment must require zero application-source
modifications for shop configuration. Shop data belongs in the database or
configuration/onboarding layer; secrets and deployment values belong in
environment/deployment configuration. Client-specific source forks and
conditional branches are prohibited.

Inspect the existing architecture before changing it. Preserve compliant
functionality and do not perform unnecessary rewrites. Correct violations
instead of normalizing them. Run `npm run architecture:check` and relevant
tests, lint, typecheck, and build checks, and report unresolved risks. Never
commit secrets or client-specific data.

Do not justify a violation as temporary, client-only, faster, or something to
refactor later. Treat the zero-source-modification rule as protected change
control. Changes to the constitution require documented rationale and review.
