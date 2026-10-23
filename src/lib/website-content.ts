// ============================================================================
// WEBSITE CONTENT DRAFT LIFECYCLE
//
// Every business owns at most one WebsiteContent row (unique businessId).
// That row is the DRAFT the owner edits in Settings; publishing snapshots
// it into publishedContent. Historically the row was only created lazily,
// the first time an owner saved a website-section field — so a fresh shop
// that went straight to "Publish website" hit a confusing
// "No website content to publish yet" 404.
//
// This module centralizes the idempotent draft initialization:
//   • Business-creation paths seed the draft together with the business.
//   • Any path that needs the draft (e.g. publishing) can ensure it exists
//     without ever overwriting existing draft or published content.
//
// All fields on WebsiteContent are optional — an "empty" draft is valid:
// the public site falls back to business data per field, exactly what it
// already renders before the first publish (legacy parity).
// ============================================================================

import type { Prisma, PrismaClient, WebsiteContent } from '@prisma/client'

type Tx = Prisma.TransactionClient | PrismaClient

/**
 * Returns the business's website-content draft, creating an empty one when
 * the business has none. Never overwrites an existing draft, never touches
 * publishedContent, and cannot attach content to the wrong business (the
 * row is keyed by the unique businessId).
 */
export async function ensureWebsiteContentDraft(tx: Tx, businessId: string): Promise<WebsiteContent> {
  const existing = await tx.websiteContent.findUnique({ where: { businessId } })
  if (existing) return existing
  // upsert guards the unique constraint against a concurrent create
  return tx.websiteContent.upsert({
    where: { businessId },
    create: { businessId },
    update: {},
  })
}
