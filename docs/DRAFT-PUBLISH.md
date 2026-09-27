# Draft / Publish for Website Content

Public homepage content supports the workflow:

**EDIT → SAVE DRAFT → PREVIEW → PUBLISH**

## Model

- The editable `WebsiteContent` fields (hero, section titles/descriptions,
  section visibility toggles, featured review count) are the **DRAFT**.
- Publishing snapshots those fields into `publishedContent` (JSON) and
  stamps `publishedAt`.
- The customer homepage renders the **published snapshot** when one
  exists.
- Before the first publish, `publishedContent` is null and the public
  site renders the live fields — exact parity with how existing
  deployments behave today, so nothing changes until a shop opts into
  publishing.

## Flow

1. **Edit** — Settings → Website sections (existing editor).
2. **Save** — the existing save API writes draft fields only.
3. **Preview** — Settings → "Preview draft" opens
   `/dashboard/website-preview`, an authenticated staff-only page that
   renders the draft exactly as the homepage would show it once
   published. Anonymous users are redirected to login; draft content is
   never reachable publicly.
4. **Publish** — Settings → "Publish website" (owner-only,
   `POST /api/dashboard/website-content/publish`) snapshots the draft,
   stamps `publishedAt`, and writes a `WEBSITE_CONTENT_PUBLISHED` audit
   entry. The status card shows the last publish time and whether
  unpublished draft changes exist.

## Scope and remaining areas

Draft/publish covers the **WebsiteContent** surfaces (hero, services,
team, reviews, visit, FAQ, final CTA, section toggles) — the
highest-value public content, rendered from one source of truth.

Intentionally NOT draft/published yet (they are live-on-save, as
designed):
- Branding (colors/fonts/theme) — applied live via the theme system.
- Services, barbers, hours — operational data that staff schedules and
  booking depend on; a publish gate here would risk the booking flow
  drifting from what staff see.
- Gallery and testimonials moderation — these already have their own
  visibility/approval flows.

Adding draft/publish to another surface means: a published snapshot
column, a render-time snapshot preference in its public reader, an
owner-only publish endpoint, an audit action, and a test proving the
draft is not public before publish.
