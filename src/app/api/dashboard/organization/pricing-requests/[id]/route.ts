import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth-helpers'
import { buildConfigAuditEntry } from '@/lib/organization/config-audit'
import { decisionVerdict, money, revokeVerdict } from '@/lib/organization/pricing-approvals'
import { resolveOrganizationContext } from '@/lib/organization/resolve'

export const dynamic = 'force-dynamic'

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/**
 * Approve, decline or revoke one price request.
 *
 * Approval is the only thing that writes an OrganizationServicePriceException, so the price
 * resolver never sees an unapproved price. Revoking deletes that exception and returns the
 * location to the standard price; the request row keeps the record of both decisions.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth()
  if (!auth.success) return auth.response

  const resolved = await resolveOrganizationContext(auth.user.id)
  if (!resolved.ok || !resolved.context) {
    return NextResponse.json({ error: 'You are not a member of an organization.' }, { status: 403 })
  }
  const context = resolved.context

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'The request could not be read.' }, { status: 400 })
  }

  const decision = str(body.decision)
  if (decision !== 'approve' && decision !== 'decline' && decision !== 'revoke') {
    return NextResponse.json({ error: 'Choose approve, decline or revoke.' }, { status: 400 })
  }

  const { id } = await params
  const request = await prisma.organizationServicePriceRequest
    .findFirst({ where: { id, organizationId: context.organizationId } })
    .catch(() => null)
  if (!request) return NextResponse.json({ error: 'That request could not be found.' }, { status: 404 })

  const verdict = decision === 'revoke' ? revokeVerdict(context.role, request.status) : decisionVerdict(context.role, request.status)
  if (!verdict.allowed) return NextResponse.json({ error: verdict.reason }, { status: 403 })

  const note = str(body.note)
  const now = new Date()

  try {
    await prisma.$transaction(async (tx) => {
      if (decision === 'approve') {
        await tx.organizationServicePriceException.upsert({
          where: { templateId_businessId: { templateId: request.templateId, businessId: request.businessId } },
          create: {
            templateId: request.templateId,
            businessId: request.businessId,
            priceCents: request.priceCents,
            reason: request.reason,
            approvedById: auth.user.id,
          },
          update: { priceCents: request.priceCents, reason: request.reason, approvedById: auth.user.id },
        })
      }
      if (decision === 'revoke') {
        await tx.organizationServicePriceException.deleteMany({
          where: { templateId: request.templateId, businessId: request.businessId },
        })
      }
      await tx.organizationServicePriceRequest.update({
        where: { id: request.id },
        data: {
          status: decision === 'approve' ? 'APPROVED' : decision === 'decline' ? 'DECLINED' : 'REVOKED',
          decidedById: auth.user.id,
          decidedAt: now,
          decisionNote: note,
        },
      })
      await tx.organizationConfigAudit.create({
        data: buildConfigAuditEntry({
          organizationId: context.organizationId,
          actorId: auth.user.id,
          action: 'pricing.' + decision,
          entity: 'OrganizationServicePriceRequest',
          entityId: request.id,
          summary:
            decision === 'approve'
              ? `Approved ${money(request.priceCents)} at this location.`
              : decision === 'decline'
                ? `Declined a request to charge ${money(request.priceCents)} at this location.`
                : `Revoked an approved price of ${money(request.priceCents)}. The location returns to the standard price.`,
          previousValue: { status: request.status, priceCents: request.priceCents },
          newValue: { status: decision === 'approve' ? 'APPROVED' : decision === 'decline' ? 'DECLINED' : 'REVOKED', note: note ?? null },
          at: now.toISOString(),
        }),
      })
    })
  } catch {
    return NextResponse.json({ error: 'The decision could not be saved. Nothing has changed.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
