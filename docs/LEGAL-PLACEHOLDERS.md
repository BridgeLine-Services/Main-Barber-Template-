# Legal Placeholders — Master Template IP & Policies

> **STATUS: DRAFT FOR ATTORNEY REVIEW.** These documents are structural
> placeholders only. They are not legal advice and must be reviewed and
> approved by qualified counsel in the relevant jurisdiction(s) before any
> commercial use. No warranty of legal sufficiency is made.

This file defines the legal-document structure the master template carries
and who must complete each piece before client delivery.

## 1. Platform IP vs. Business Content

Two categories must never be conflated:

| Platform IP (BridgeLine / template owner) | Business Content (client-owned) |
| --- | --- |
| Source code, architecture, components | Business name, logo, brand assets |
| Booking engine and business logic | Barber photos, gallery images |
| Database schema and migrations | Service names, pricing, descriptions |
| Admin dashboard UI | Customer records (subject to law/agreements) |
| Documentation, workflows | Business contact info, hours, SEO copy |

Client agreements grant the client rights to **use** the software for their
business and own their **content/data**. They do not transfer ownership of
the template software or its source code.

## 2. Master License Grant (attorney to draft)

A client-facing license document must define, at minimum:

- Ownership of the template software and all derivatives
- License grant scope (per-business, non-exclusive, non-transferable)
- Permitted use / prohibited use (resale, sublicensing, redistribution,
  source-code disclosure, derivative works)
- Term, termination, and post-termination obligations (data return,
  license cessation)
- Confidentiality obligations
- Enforcement, remedies, governing law, venue/dispute resolution

## 3. Terms of Service (client websites)

The customer-facing `/terms` page structure covers: acceptable use,
prohibited activities, user accounts, business accounts, payments/fees,
intellectual property, third-party services, availability/maintenance,
suspension/termination, disclaimers, liability limitations, dispute
resolution, governing law. **Per-section wording must be finalized by
counsel per deployment.**

## 4. Privacy Policy (client websites)

The customer-facing `/privacy` page structure covers: information
collected, collection methods, purpose and usage, storage, access,
third-party services, necessary cookies, retention, deletion, access/export
rights, security practices, children's information, and privacy contact.
Wording must be reviewed to match each deployment's actual integrations
(email provider, analytics, maps, payments). **Do not make privacy claims
the deployed system does not satisfy.**

## 5. Cookie Disclosure

The system uses only strictly necessary cookies (staff sessions, booking /
portal lookup tokens). No advertising or analytics cookies are set by the
template. If a deployment adds analytics or advertising cookies, the
privacy page and any required consent banner must be updated for that
deployment.

## 6. Support & Maintenance

Bug fixes, security fixes, dependency updates, database maintenance,
third-party integrations, and deployment support responsibilities belong in
the client services agreement, separately from the license. Nothing in
this repository defines SLA commitments.

## Completion checklist (before first commercial client delivery)

- [ ] Master License Grant drafted and approved by counsel
- [ ] Terms of Service reviewed for target jurisdictions
- [ ] Privacy Policy matched to actual deployed integrations
- [ ] Client services/support agreement drafted
- [ ] Data-processing terms (customer records) reviewed (e.g. GDPR/CCPA
      applicability)
