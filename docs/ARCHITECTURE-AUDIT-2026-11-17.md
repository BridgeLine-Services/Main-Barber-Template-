# Architecture audit: enhancement program, baseline `ad0ddb7`

Phase 1 deliverable for the Safe Enhancement, Usability, Branding, SEO and Reliability
Program. Nothing in the application was changed to produce this document; it is what the
code actually does today, read from the files rather than assumed.

Baseline commit: `ad0ddb7`, `main`, working tree clean.

## 1. Baseline health

| Gate | Result |
| --- | --- |
| Template CI, Validate template | PASS, all steps |
| Template CI, E2E browser tests | PASS, all steps, 70 Playwright specs |
| `architecture:check` / `test:architecture` | PASS |
| `typecheck` | PASS |
| `lint` | PASS, 0 errors, 98 warnings |
| `build` | PASS, 75 pages |
| Owner registration journey | 28 checks |
| RLS enforcement (throwaway database) | 42 checks |
| Backup, archive, off-site rehearsal | PASS, objects read back |

Runtime today: Node 20.20.2 (Iron, maintenance), Next 16.4.6, React 19.3.0,
Prisma 6.19.3, TypeScript 5.5.4. `package.json` declares `engines.node >= 20`.
67 Prisma models, 104 test files.

## 2. Method

Every file named in Part 2 was read. For each capability the question asked was not
"what should we build" but "what already exists, and what is genuinely missing".

Two conclusions shaped the plan:

1. Most of Parts 4, 5 and 6 already exist in working form. Building new subsystems for
   them would create exactly the duplicate systems Part 1 forbids.
2. The real gaps are narrower than the prompt assumes: contrast warnings, identity
   previews with real content, a unified owner reliability screen, and the Node runtime.

## 3. Feature audit

### 3.1 Visual identities (Part 4)

| Item | Finding |
| --- | --- |
| Existing feature | 8 identities with stable ids: `black-label`, `barber-heritage`, `street-cut`, `clean-club`, `modern-classic`, `warm-premium`, `high-energy-urban`, `single-chair` |
| Implementation | `src/lib/visual-style.ts` (95 lines: `VISUAL_STYLES`, `VISUAL_STYLE_CONFIG`, `getVisualStyle`, `visualStyleClass`, `buttonStyleClass`, `imageStyleClass`) |
| Database | `Business.visualStyle`-class field via `WebsiteContent`/business settings; the value is a stored string validated by `getVisualStyle`, so an unknown value degrades to a default rather than throwing |
| API | Dashboard appearance route behind the existing authenticated dashboard |
| Permissions | Owner and co-owner with appearance rights, enforced server-side |
| Tests | `tests/visual-config.test.ts`, `tests/theme-sanitization.test.ts`, plus architecture rules |
| Already satisfies | Selecting an identity, per-identity layout options (`HERO_LAYOUTS`, `SERVICE_LAYOUTS`, `BARBER_LAYOUTS`, `GALLERY_LAYOUTS`, `MOTION_LEVELS`, `BUTTON_STYLES`, `IMAGE_SHAPES`), draft and publish already present in `AppearanceTab.tsx` (408 lines: 16 preview references, 11 draft, 3 publish) |
| Genuine gap | No side-by-side identity comparison, no desktop/mobile split preview of all eight, no guided recommendation assistant, and contrast feedback is thin (one reference in `AppearanceTab.tsx` against `readableForegroundFor` in `theme.ts`) |
| Proposal | Extend `AppearanceTab` with an identity gallery (all 8, real business content, desktop/mobile toggle) and a recommendation assistant that only ever returns one of the existing 8 ids. Strengthen contrast warnings using `isValidHexColor` and `hexToHsl`, which already exist |
| Regression risk | Medium: `AppearanceTab` is the file owners use daily |
| Migration needed | No |
| Backwards compatibility | Required and easy: ids and stored values unchanged, so no saved selection can move |
| How tested | Extend `tests/visual-config.test.ts` (ids stable, unknown values still degrade), add recommendation unit tests asserting the output is always in `VISUAL_STYLES`, run the appearance journey in Playwright |

### 3.2 Typography and colour (Part 4.2)

| Item | Finding |
| --- | --- |
| Existing | 7 fonts: `inter`, `poppins`, `montserrat`, `playfair`, `roboto`, `oswald`, `lato` (`FONT_FAMILY_OPTIONS`); `generateThemeCSS`, `mapFontFamily`, `readableForegroundFor`, `isValidHexColor`, `hexToHsl` in `src/lib/theme.ts` (224 lines) |
| Already satisfies | All 7 fonts, sanitized colours, guaranteed readable foreground, CSS generation per scope |
| Genuine gap | Owner-facing contrast explanation is not expressed in business language, and there is no warning when a chosen pair is technically valid but unreadable at body size |
| Proposal | Keep every validation path; add plain-language contrast guidance and a "this text may be hard to read" warning that never blocks saving a draft, only warns before publish |
| Migration | No |
| Compatibility | Required: no new font without verifying the asset is loaded; `mapFontFamily` must keep its current mappings |

### 3.3 Homepage modules (Part 5)

| Item | Finding |
| --- | --- |
| Existing | `src/lib/home-modules.ts` (285 lines): `HOME_MODULE_IDS` of 13 modules (`hero`, `quickBook`, `shopStatus`, `featuredWork`, `services`, `team`, `beforeAfter`, `reviews`, `socialGallery`, `shopExperience`, `visit`, `faq`, `finalCta`), `ALWAYS_ON_MODULES = ['hero']`, `LEGACY_TOGGLE` map, `resolveHomeModules`, `StoredHomeModules` |
| Database | `WebsiteContent`: per-section columns including `heroEyebrow`, `heroTitle`, `heroDescription`, `heroImageUrl`, both CTA label/href pairs, legacy booleans `showServices`, `showTeam`, `showReviews`, `showVisit`, `showFaq`, `showFinalCta`, plus `publishedContent` JSON snapshot and `publishedAt` |
| Rendering | `src/components/customer/home/CustomerHomepage.tsx` (1318 lines) |
| Tests | `tests/home-modules.test.ts` |
| Already satisfies | Module enable/disable, ordering, legacy derivation, draft/publish snapshot, hero forced on and first, new modules not appearing on an existing site until the owner publishes |
| Genuine gap | No owner-facing section-content editor beyond the hero, no "restore a previous published version" surface, no business-stage recommendations |
| Proposal | Build the editor on top of the existing resolver and snapshot: reorder and toggle through `resolveHomeModules`, edit headings into the existing columns, add a read-only history from `publishedContent` with an explicit restore that writes a new draft (never a silent publish) |
| Regression risk | High if the resolver is touched. It must not be |
| Migration | No |
| Compatibility | Critical. A business with no `homeModules` saved must keep rendering exactly its legacy toggles |
| How tested | Table-driven tests per module id, legacy-only fixture, saved-modules fixture, and a publish-snapshot test proving an untouched site renders identically |

### 3.4 SEO (Part 6)

| Item | Finding |
| --- | --- |
| Existing | `src/lib/seo.ts` (196 lines): `generateLocalBusinessSchema`, `generateServiceSchema`, `generateFAQSchema`, `generateBreadcrumbSchema`, `generateWebsiteSchema`; `src/components/customer/SEO.tsx`, `src/components/seo/JsonLd.tsx`, `StructuredData.tsx`; `src/app/api/dashboard/seo/route.ts` (87 lines) exports `GET` returning `{ seo }` and `PATCH` |
| Tests | Covered by architecture and template rules; no dedicated SEO health suite |
| Already satisfies | All five schema types of Part 6.2, per-business metadata, editable SEO through the dashboard route |
| Genuine gap | No health report (missing titles, descriptions, alt text, canonical, indexing), no plain-language explanations |
| Proposal | Add a read-only report computed from existing business records, rendered in the dashboard. Never invent ratings, hours, addresses or reviews; every field comes from a record or is reported missing |
| Migration | No |
| Compatibility | Required: `GET /api/dashboard/seo` keeps its shape; a report goes on a new field or route |

### 3.5 Reliability (Part 7)

| Item | Finding |
| --- | --- |
| Existing | `src/lib/health.ts` (321 lines: `CheckStatus`, `DependencyRole`, `ReadinessReport`, `BACKUP_FRESHNESS`, `evaluateBackupFreshness`, `checkDatabase`, `checkRateLimitStore`), `src/lib/system-status.ts` (142 lines: `buildOwnerStatus`, `describeOwnerStatus`, tones `good|watch|action|off`), `src/lib/production-readiness.ts` (336 lines: factory checks), `scripts/env-doctor.ts`, `scripts/check-env-drift.mjs`, `scripts/backup-offsite.ts`, `scripts/backup-freshness.ts`, `src/lib/backup/`, six workflows |
| Already satisfies | Health and readiness probes, dependency roles, backup freshness evaluation, owner-facing tone system, factory readiness, off-site rehearsal in CI |
| Constraint | `src/lib/reliability.ts` is appointment and no-show scoring. It must not be repurposed |
| Genuine gap | No dependency lifecycle monitor (Node, Next, React, Prisma), no owner Reliability Program screen combining health, booking, backups and updates, no maintenance advisor or repair classifier |
| Proposal | New `src/lib/platform-reliability/` that only composes existing checks and adds version and support-window knowledge. Nothing existing is moved |
| Migration | No |

### 3.6 Onboarding (Part 8, Phase 7)

| Item | Finding |
| --- | --- |
| Existing | `OnboardingWizard.tsx` with steps `business`, `branding`, `services`, `booking`, `review`; routes `src/app/api/dashboard/onboarding/{route.ts,review,services,team}` |
| Genuine gap | No plain-language explanation of what each step produces, no business-stage defaults |
| Proposal | Copy, guidance and optional recommendations only. No step removed, no step reordered |

### 3.7 Runtime (Part 7.2)

Node 20 is end-of-life. Target Node 24 LTS. This is the one Phase 2 item that is both
real and fully verifiable in the sandbox: swap the runtime, run the whole suite and the
production build, and only then change `engines`, the CI `node-version` and the README.

## 4. Duplicate systems this program will not build

| Tempting duplicate | Why not | Use instead |
| --- | --- | --- |
| A second theme engine | `theme.ts` already generates scoped CSS with sanitized input | Extend `generateThemeCSS` |
| A second publish system | `WebsiteContent.publishedContent` + `publishedAt` already is one | Publish through the existing action |
| A ninth visual identity | Part 4 says preserve the eight | Recommendation returns one of the eight |
| A new reliability scorer | `src/lib/reliability.ts` owns appointments | `src/lib/platform-reliability/` for platform only |
| A `Location` model now | Part 9 defers it | `Business` stays the tenant |

## 5. Parts 1 to 12: where each stands

| Part | Subject | Status |
| --- | --- | --- |
| 1 | Role and priority | Accepted as the governing rule |
| 2 | Inspect before modifying | **This document** |
| 3 | Safeguards | In force: zero-regression, no production data, CI green, additive-only changes |
| 4 | Branding and the eight identities | **Not started.** Audit done; implementation next |
| 5 | Homepage management | **Not started.** Audit done, architecture preserved by plan |
| 6 | SEO and reviews | **Not started.** Audit done |
| 7 | Reliability program | **Partly done.** Probes, freshness, off-site rehearsal, alerting and owner status exist and are CI-proven. Dependency monitor and owner screen remain |
| 8 | Every user type | **Partly done.** Four role dashboards exist; changes in this program not started |
| 9 | Future growth | **Intentionally deferred** by the prompt itself |
| 10 | Testing and regression | **Baseline done.** All gates and the full chain pass; the 25 named regression scenarios need explicit, itemised evidence |
| 11 | Release and completion rules | In force: quoted evidence, PASS/FAIL/BLOCKED/NOT TESTED, no unapproved deploy |
| 12 | Development order | Phase 1 complete with this audit |

One conflict to record: Part 3.1 says never merge to `main` without approval, and the
owner has explicitly instructed that work be pushed and merged to `main`. The owner's
instruction governs; every change is still gated by the full test chain before it lands.

## 6. Next phases, in order

1. Phase 2: Node 24 LTS migration, proven by the full suite and a production build.
2. Phase 3: identity gallery, real-content previews, contrast guidance, recommendation assistant.
3. Phase 4: homepage content editor and published-version restore.
4. Phase 5: SEO health report.
5. Phase 6: `platform-reliability` monitor, advisor and owner screen.
6. Phase 7: onboarding guidance.
7. Phase 8: the 25 regression scenarios, accessibility and mobile acceptance.
8. Phase 9: release report.
