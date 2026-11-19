# Commercial priorities: what exists, what does not

Inspected at `7ac8dd5`. Every line names the file that decides it, so a claim can be
checked rather than believed. Statuses follow the directive's five classes.

## Priority 1: independent barber experience

| Feature | Status | Evidence |
|---|---|---|
| `/barbers/[slug]` page | Implemented and tested | `src/app/(customer)/barbers/[slug]/page.tsx`: portfolio, before/after, reviews, pricing, booking, Instagram, Facebook |
| Individual barber analytics | Partially implemented | `src/lib/analytics.ts` gives services per barber and peak hours; no per-barber revenue or client retention |
| Personalised QR booking code | Not implemented | No QR encoder or generator anywhere in `src` |
| Unique barber referral link | Partially implemented | `src/lib/booking-source.ts` records source; nothing attributes a booking to a barber |
| Referral rewards and redemption | Not implemented | No model, no ledger. **Needs a migration, so it stops at the gate** |
| TikTok support | Not implemented | Only Instagram and Facebook are read; `Barber` has no TikTok field, so this is also a migration |
| Simple portfolio management | Partially implemented | `BarberForm` sets one photo; gallery management lives in featured work, not per barber |
| Personal growth overview | Not implemented | No barber-scoped reporting page |

## Priority 2: shop owner experience

| Feature | Status | Evidence |
|---|---|---|
| Queue, waitlist, commission, payroll, payments | Implemented and tested | `src/lib/queue.ts`, `commissions.ts`, `payroll.ts`, existing ops suites |
| Estimated wait from real data | Implemented and tested | `estimateWaitMinutes`, `entriesAheadOf` in `queue.ts` compute from positions and barber availability |
| Customer check-in, live status, staff board, chair-ready notice | Partially implemented | Queue positions and ETAs exist in the library; the customer-facing and staff-facing surfaces were not verified this pass |
| Percentage and fixed-per-service commission | Implemented and tested | `resolveRate`, `rateLabel`, `computeCommission` in `commissions.ts` |
| Hourly, booth rental, hybrid, product commission | Partially implemented | Product line items are commissioned (`createCommissionsForCheckout`); hourly/booth/hybrid rate types were not found in `resolveRate` |
| Payroll separated from tax filing | Implemented | `payroll.ts` computes; no filing code exists |
| Cancellations, no-shows, peak hours, per-barber | Implemented and tested | `analytics.ts` exposes cancellationRate, noShowRate, peakHours |
| Utilisation, membership revenue, retail sales | Partially implemented | Retail items exist in commissions; utilisation and membership revenue were not found |
| Plain-English explanations | Partially implemented | Analytics labels exist; no narrative generator over verified data |

## Priority 3: business growth centre

| Feature | Status | Evidence |
|---|---|---|
| Campaign infrastructure | Implemented and tested | `marketing.ts`: `resolveCampaignAudience`, `createCampaign`, `sendCampaign` |
| Review requests | Implemented and tested | `review-requests.ts` plus the owner panel added this program |
| Rebooking and retention | Implemented and tested | `rebooking-engine.ts`, `retention.ts`, `retention-dashboard.ts` |
| Email marketing | Implemented and tested | `email-marketing.ts` |
| Birthday segmentation | **Blocked by schema** | `marketing.ts` line 172 says it plainly: the audience needs a birthday field that `Customer` does not have. Consented field + migration, so it stops at the gate |
| Referral campaigns and rewards | Not implemented | Depends on the referral ledger above |
| Win-back and slow-day recommendations | Partially implemented | Audience resolution supports dormant customers; no slow-day recommendation engine |
| Marketing performance reporting | Partially implemented | Campaign rows exist; no consolidated performance view |
| AI-assisted copy | Not implemented | No generation path, and none should be simulated |
| Google integration status | Partially implemented | `google-business.ts` holds OAuth state and sync; this program documented that live sync is not verified |

## Priority 4: website builder

| Feature | Status | Evidence |
|---|---|---|
| Eight identities, comparison, real previews, recommendations, contrast help | Implemented and tested | `visual-style.ts`, comparison grid, assistant, `review-invite-copy.ts` style guidance, 92 checks |
| Homepage section content editing | Implemented and tested | `HomeModulesCard` heading and blurb editing, `home-modules.ts` resolver untouched |
| Custom navigation editing | Not implemented | No custom nav model or editor |
| Tablet previews | Not implemented | Desktop and mobile only |
| Published-version history and safe restore | **Blocked by schema** | `WebsiteContent` keeps one `publishedContent` snapshot. History needs an additive table, which the owner is reviewing |
| Additional layouts, video backgrounds, banners, feeds, footer layouts | Not implemented | Not started, and each needs its security, performance and accessibility review first |

## What this means

Nothing here was rebuilt. Two of the four priorities are largely served by libraries that
already existed and are already tested. Four items cannot be finished without a database
change: referral rewards, TikTok, birthday segmentation and published-version history.
Those are exactly the changes the owner asked to review before any of them touch a
production database, so they are documented and stopped rather than forced.
