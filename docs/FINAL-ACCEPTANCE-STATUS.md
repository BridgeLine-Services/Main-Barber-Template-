# Acceptance status

Where the platform brief's acceptance criteria (Section 23) actually stand. Every line is
either backed by a test that runs, or says plainly that it is not done. Last updated
2026-11-25 (later commit) against `main`.

## Security
| Criterion | Status | Evidence |
| --- | --- | --- |
| Tenant context in real protected queries | **Partial** | `withTenant()` exists but is not yet wired into query call sites; routes scope by a session-resolved business. Section 5 still open. |
| Cross-tenant regression tests | **Partial** | Organization isolation suites cover organization/location boundaries; `tests/tenant-scoping-guard.test.ts` audits all 156 dashboard routes for IDOR patterns and passes. No `withTenant` cross-tenant suite. |
| Organization scope explicit and fail-closed | **Done** | `resolveOrganizationContext`, `capabilities.ts`, `tests/organization-isolation.test.ts`, `tests/organization-architecture.test.ts`. |
| Production RLS only after prerequisites | **Correctly gated** | Not enabled. `docs/RLS-STAGING-PLAN.md`, `prisma/rls/production-rls.sql` unchanged. |
| Role and location permissions server-side | **Done** | Every organization route re-resolves context and re-checks capability; `tests/organization-location-management.test.ts`, `tests/organization-assignments.test.ts`. |

## Scheduling
| Criterion | Status | Evidence |
| --- | --- | --- |
| 15-minute schedule preserved | **Done** | `config/vercel/crons.pro.json`, `vercel.json`, `tests/cron-plan.test.ts`. |
| Can be disabled safely | **Done** | `ORGANIZATION_REPORT_CRON_ENABLED`, `src/lib/cron-flags.ts`. |
| Can be enabled without rewriting | **Done** | Set the flag to `true`; `docs/CRON-SCHEDULING.md`. |
| Hobby compatibility handled honestly | **Done** | `config/vercel/crons.hobby.json` omits the sub-daily job rather than downgrading it. |
| Cron auth and idempotency | **Done** | `CRON_SECRET` check; `organizationReportIdempotencyKey(config.id, scheduledFor)`. |

## Organization management
| Criterion | Status | Evidence |
| --- | --- | --- |
| Corporate and location workflows end to end | **Done** | Location create/edit/close/reopen, assignments, regions, pricing approvals; four suites. |
| Invitations work securely | **Done** | `tests/organization-invitations.test.ts` (needs `DATABASE_URL`). |
| Service templates without overwriting location prices | **Done** | `resolveServicePrice` untouched; requests kept in their own table. |
| Branding inheritance and overrides | **Done** | `resolveBrandField` distinguishes absent from cleared; `tests/branding-overrides.test.ts`. |
| No cross-organization access | **Done** | Resolver + capability checks + isolation suites. |

## Website management
| Criterion | Status | Evidence |
| --- | --- | --- |
| Navigation editable through the dashboard | **Done** | `/dashboard/website-navigation`, `src/lib/website-navigation.ts`, `tests/website-navigation.test.ts`. |
| Drafts and published content separate | **Done** | `publishedContent` snapshot; `tests/website-publish.test.ts` (needs `DATABASE_URL`). |
| Version history retained | **Done** | `WebsiteContentVersion`, append-only on publish. |
| Previous versions restored to a draft | **Done** | Restore route writes the draft only. |
| Desktop, tablet and mobile previews | **Done** | Existing preview modes preserved. |

## Growth
| Criterion | Status | Evidence |
| --- | --- | --- |
| Barber analytics on real data | **Done** (earlier phase) | `src/lib/growth/barber-analytics.ts`. |
| Referral rewards auditable lifecycle | **Not done** | Section 10 open; no ledger model yet. |
| Birthday segmentation respects zones and consent | **Done** | `src/lib/marketing/birthday.ts`, `tests/marketing-birthdays.test.ts`. |
| Marketing performance uses supported attribution | **Not done** | Section 12 open. |

## Reliability
| Criterion | Status | Evidence |
| --- | --- | --- |
| Dependency support status meaningful or unknown | **Done** | `supportedFlag()` from `COMPATIBILITY_RULES`, `tests/dependency-support-status.test.ts`. |
| Advisory and update checks still live | **Done** | Unchanged; `live-advisories.ts`, `live-updates.ts`. |
| Recovery evidence intact | **Done** | Unchanged; `scripts/rehearse-restore.ts`. |
| Maintenance scheduling wired | **Done** | Daily entry in both cron plans. |

## Client distribution
| Criterion | Status | Evidence |
| --- | --- | --- |
| Client-copy protections intact | **Done** | Scripts untouched; `client:independence` passes. |
| Template updates assessed safely | **Not done** | Section 15 open. |
| Independent configurations work | **Not done** | Section 15 test matrix open. |

## Quality
| Criterion | Status | Evidence |
| --- | --- | --- |
| Existing tests continue to pass | **Done** | Suites listed in each phase report. |
| New features have regression tests | **Done** | Per feature. |
| TypeScript safety improves | **Partial** | Three zero-cost strict flags enabled (`noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`); remaining 701 errors measured and ordered in `docs/TYPESCRIPT-STRICTNESS.md`. `strict` is still `false`. |
| Accessibility and responsive tests remain | **Done** | `accessibility-guard` and `visual-config` pass; the brand-colour contrast audit is tested and shown in the setup wizard and the organization brand editor, where colours are chosen. |
| Application builds | **Done** | `npm run build` compiled. |
