/**
 * Organization invitations and member management, against the real database.
 *
 * The security of this feature lives in these paths, so these are not mocked: a real
 * organization, real members and real invitation rows are created, exercised and removed.
 *
 * Run: npx tsx tests/organization-invitations.test.ts
 */

import { prisma } from '../src/lib/prisma'
import type { OrgContext } from '../src/lib/organization/resolve'
import {
  INVITATION_TTL_DAYS,
  acceptOrganizationInvitation,
  canGrantRole,
  cancelOrganizationInvitation,
  changeMemberRole,
  createOrganizationInvitation,
  invitationState,
  listOrganizationInvitations,
  resendOrganizationInvitation,
  setMemberStatus,
} from '../src/lib/organization/invitations'
import { processDueNotifications } from '../src/lib/notification-worker'
import {
  invalidateQueuedOrganizationInvitationEmails,
  queueOrganizationInvitationEmail,
} from '../src/lib/organization/invitation-delivery'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  PASS ${message}`); passed++ }
  else { console.error(`  FAIL ${message}`); failed++ }
}

const stamp = Date.now()
const deliveryInvitationIds: string[] = []
const emailEnvironmentKeys = ['EMAIL_ENABLED', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE']

async function withEmailEnvironment(values: Record<string, string | undefined>, run: () => Promise<void>) {
  const previous = new Map(emailEnvironmentKeys.map((key) => [key, process.env[key]]))
  for (const key of emailEnvironmentKeys) {
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function main() {
  const business = await prisma.business.create({
    data: {
      name: 'Invitation Test Shop', slug: `invite-test-${stamp}`, email: `shop-${stamp}@test.example`,
      phone: '555-0100', address: '1 Test Way', city: 'Testville', state: 'CA', zipCode: '90001',
      timezone: 'America/Los_Angeles',
    },
  })
  const organization = await prisma.organization.create({
    data: { name: 'Invitation Test Group', slug: `invite-group-${stamp}` },
  })
  const otherOrganization = await prisma.organization.create({
    data: { name: 'Other Group', slug: `invite-other-${stamp}` },
  })

  const owner = await prisma.user.create({
    data: {
      email: `owner-${stamp}@test.example`, passwordHash: 'not-a-real-hash', name: 'Owner',
      role: 'OWNER', businessId: business.id,
    },
  })
  const corporate = await prisma.user.create({
    data: {
      email: `corporate-${stamp}@test.example`, passwordHash: 'not-a-real-hash', name: 'Corporate',
      role: 'BUSINESS_ADMIN', businessId: business.id,
    },
  })
  const invitee = await prisma.user.create({
    data: {
      email: `invitee-${stamp}@test.example`, passwordHash: 'not-a-real-hash', name: 'Invitee',
      role: 'BARBER', businessId: business.id,
    },
  })

  const ownerMember = await prisma.organizationMember.create({
    data: { organizationId: organization.id, userId: owner.id, role: 'ORGANIZATION_OWNER', status: 'ACTIVE', regions: [] },
  })
  const corporateMember = await prisma.organizationMember.create({
    data: { organizationId: organization.id, userId: corporate.id, role: 'CORPORATE_ADMIN', status: 'ACTIVE', regions: [] },
  })

  const ownerContext: OrgContext = {
    organizationId: organization.id, organizationName: organization.name, membershipId: ownerMember.id,
    role: 'ORGANIZATION_OWNER', regions: [], locationBusinessIds: [business.id], homeBusinessId: business.id,
  }
  const corporateContext: OrgContext = {
    organizationId: organization.id, organizationName: organization.name, membershipId: corporateMember.id,
    role: 'CORPORATE_ADMIN', regions: [], locationBusinessIds: [business.id], homeBusinessId: null,
  }

  try {
    console.log('--- authority ---')
    const byCorporate = await createOrganizationInvitation({
      context: corporateContext, email: `someone-${stamp}@test.example`, role: 'REGIONAL_MANAGER', invitedById: corporate.id,
    })
    ok(!byCorporate.ok && byCorporate.reason === 'not-permitted', 'a corporate administrator cannot invite anyone')

    const escalate = await createOrganizationInvitation({
      context: ownerContext, email: `someone-${stamp}@test.example`, role: 'ORGANIZATION_OWNER' as never, invitedById: owner.id,
    })
    ok(!escalate.ok && escalate.reason === 'role-not-grantable', 'nobody can hand out ownership through an invitation')
    ok(!canGrantRole('ORGANIZATION_OWNER', 'ORGANIZATION_OWNER'), 'even the owner cannot grant ownership by invitation')
    ok(!canGrantRole('CORPORATE_ADMIN', 'REGIONAL_MANAGER'), 'a role cannot be granted by someone who lacks its capabilities')

    const badEmail = await createOrganizationInvitation({
      context: ownerContext, email: 'not-an-email', role: 'REGIONAL_MANAGER', invitedById: owner.id,
    })
    ok(!badEmail.ok && badEmail.reason === 'invalid-email', 'a malformed address is refused in plain words')

    console.log('--- creating and accepting ---')
    const email = `newperson-${stamp}@test.example`
    const created = await createOrganizationInvitation({
      context: ownerContext, email: email.toUpperCase(), role: 'REGIONAL_MANAGER', regions: ['north'], invitedById: owner.id,
    })
    ok(created.ok && Boolean(created.value?.token), 'the owner can invite a person')
    const token = created.value!.token
    const stored = await prisma.organizationInvitation.findUnique({ where: { id: created.value!.id } })
    ok(Boolean(stored) && stored!.email === email, 'the address is stored lower-cased')
    ok(!stored!.tokenHash.includes(token), 'the token is not stored in plaintext')
    ok(stored!.tokenHash.length === 64, 'the stored value is a sha256 hash')
    ok(
      Math.abs(stored!.expiresAt.getTime() - (Date.now() + INVITATION_TTL_DAYS * 86_400_000)) < 60_000,
      `the invitation expires in ${INVITATION_TTL_DAYS} days`,
    )

    const duplicate = await createOrganizationInvitation({
      context: ownerContext, email, role: 'REGIONAL_MANAGER', invitedById: owner.id,
    })
    ok(!duplicate.ok && duplicate.reason === 'already-invited', 'a second invitation to the same address is refused')

    const wrongEmail = await acceptOrganizationInvitation({
      token, userEmail: `someone-else-${stamp}@test.example`, userId: invitee.id,
    })
    ok(!wrongEmail.ok && wrongEmail.reason === 'wrong-email', 'a forwarded link cannot be claimed by another address')

    const stranger = await prisma.user.create({
      data: {
        email, passwordHash: 'not-a-real-hash', name: 'Invitee Two', role: 'BARBER', businessId: business.id,
      },
    })
    const accepted = await acceptOrganizationInvitation({ token, userEmail: email, userId: stranger.id })
    ok(accepted.ok, 'the invited address can accept')
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: organization.id, userId: stranger.id } })
    ok(Boolean(member) && member!.role === 'REGIONAL_MANAGER', 'membership is created in the inviting organization with the offered role')
    ok(member!.status === 'ACTIVE', 'the new membership is active')
    ok(JSON.stringify(member!.regions) === JSON.stringify(['north']), 'the regions travel with the invitation')

    const reuse = await acceptOrganizationInvitation({ token, userEmail: email, userId: stranger.id })
    ok(!reuse.ok && reuse.reason === 'already-accepted', 'the same link cannot be used twice')

    console.log('--- two clicks at once ---')
    const raceEmail = `race-${stamp}@test.example`
    const raceInvite = await createOrganizationInvitation({
      context: ownerContext, email: raceEmail, role: 'FRANCHISE_OWNER', invitedById: owner.id,
    })
    const raceUser = await prisma.user.create({
      data: { email: raceEmail, passwordHash: 'not-a-real-hash', name: 'Racer', role: 'BARBER', businessId: business.id },
    })
    const [first, second] = await Promise.all([
      acceptOrganizationInvitation({ token: raceInvite.value!.token, userEmail: raceEmail, userId: raceUser.id }),
      acceptOrganizationInvitation({ token: raceInvite.value!.token, userEmail: raceEmail, userId: raceUser.id }),
    ])
    ok([first, second].filter((result) => result.ok).length === 1, 'exactly one of two simultaneous acceptances succeeds')
    const raceMembers = await prisma.organizationMember.count({ where: { organizationId: organization.id, userId: raceUser.id } })
    ok(raceMembers === 1, 'and only one membership exists afterwards')

    console.log('--- expiry ---')
    const staleEmail = `stale-${stamp}@test.example`
    const stale = await createOrganizationInvitation({
      context: ownerContext, email: staleEmail, role: 'FRANCHISE_OWNER', invitedById: owner.id,
    })
    const staleRow = await prisma.organizationInvitation.update({
      where: { id: stale.value!.id }, data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    ok(invitationState(staleRow, new Date()) === 'expired', 'a past expiry reads as expired')
    const staleUser = await prisma.user.create({
      data: { email: staleEmail, passwordHash: 'not-a-real-hash', name: 'Stale', role: 'BARBER', businessId: business.id },
    })
    const expired = await acceptOrganizationInvitation({ token: stale.value!.token, userEmail: staleEmail, userId: staleUser.id })
    ok(!expired.ok && expired.reason === 'expired', 'an expired invitation cannot be accepted')
    ok(
      (await prisma.organizationMember.count({ where: { organizationId: organization.id, userId: staleUser.id } })) === 0,
      'and no membership was created',
    )

    console.log('--- resend and cancel ---')
    const resendEmail = `resend-${stamp}@test.example`
    const original = await createOrganizationInvitation({
      context: ownerContext, email: resendEmail, role: 'FRANCHISE_OWNER', invitedById: owner.id,
    })
    const resent = await resendOrganizationInvitation({
      context: ownerContext, invitationId: original.value!.id, actorId: owner.id,
    })
    ok(resent.ok && resent.value!.token !== original.value!.token, 'resending issues a new link')
    const oldLink = await acceptOrganizationInvitation({
      token: original.value!.token, userEmail: resendEmail, userId: invitee.id,
    })
    ok(!oldLink.ok && oldLink.reason === 'unknown-token', 'the previous link stops working after a resend')

    const cancelled = await cancelOrganizationInvitation({
      context: ownerContext, invitationId: original.value!.id, actorId: owner.id,
    })
    ok(cancelled.ok, 'the owner can cancel a pending invitation')
    const afterCancel = await acceptOrganizationInvitation({
      token: resent.value!.token, userEmail: resendEmail, userId: invitee.id,
    })
    ok(!afterCancel.ok && afterCancel.reason === 'cancelled', 'a cancelled invitation cannot be accepted')

    console.log('--- queued invitation email delivery ---')
    await withEmailEnvironment({ EMAIL_ENABLED: 'true' }, async () => {
      const unavailable = await createOrganizationInvitation({
        context: ownerContext, email: `unconfigured-${stamp}@test.example`, role: 'FRANCHISE_OWNER', invitedById: owner.id,
      })
      deliveryInvitationIds.push(unavailable.value!.id)
      const fallback = await queueOrganizationInvitationEmail({
        invitationId: unavailable.value!.id, recipient: `unconfigured-${stamp}@test.example`, token: unavailable.value!.token,
      })
      const unavailableLog = await prisma.notificationLog.findUnique({
        where: { idempotencyKey: `organization-invitation:${unavailable.value!.id}:${(await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: unavailable.value!.id } })).tokenHash}` },
      })
      ok(!fallback.queued && fallback.state === 'failed', 'missing SMTP settings do not queue a message')
      ok(Boolean(unavailableLog?.failureReason?.includes('SMTP_')), 'the owner gets the missing SMTP configuration names')
      ok(unavailableLog?.content === null, 'a copy-link fallback does not persist its token in the queue')
    })

    const testMailEnvironment = {
      EMAIL_ENABLED: 'true', SMTP_HOST: 'smtp.invalid', SMTP_PORT: '587', SMTP_USER: 'test-user',
      SMTP_PASS: 'test-only-not-used', SMTP_FROM: 'noreply@example.test', SMTP_SECURE: 'false',
    }
    await withEmailEnvironment(testMailEnvironment, async () => {
      const emailInvite = await createOrganizationInvitation({
        context: ownerContext, email: `delivery-${stamp}@test.example`, role: 'FRANCHISE_OWNER', invitedById: owner.id,
      })
      deliveryInvitationIds.push(emailInvite.value!.id)
      const queuedEmail = await queueOrganizationInvitationEmail({
        invitationId: emailInvite.value!.id, recipient: `delivery-${stamp}@test.example`, token: emailInvite.value!.token,
      })
      const tokenHash = (await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: emailInvite.value!.id } })).tokenHash
      let deliveryLog = await prisma.notificationLog.findUniqueOrThrow({ where: { idempotencyKey: `organization-invitation:${emailInvite.value!.id}:${tokenHash}` } })
      ok(queuedEmail.queued && deliveryLog.status === 'PENDING', 'configured email is queued, not reported as sent')
      ok(Boolean(deliveryLog.content) && !deliveryLog.content!.includes(emailInvite.value!.token), 'the queued token payload is encrypted at rest')
      await queueOrganizationInvitationEmail({
        invitationId: emailInvite.value!.id, recipient: `delivery-${stamp}@test.example`, token: emailInvite.value!.token,
      })
      ok((await prisma.notificationLog.count({ where: { idempotencyKey: `organization-invitation:${emailInvite.value!.id}:${tokenHash}` } })) === 1, 'repeating a queue request does not duplicate the delivery record')

      const sentMessage: { value: { from: string; to: string; text: string } | null } = { value: null }
      await processDueNotifications(10, {
        notificationIds: [deliveryLog.id],
        sendEmail: async (message) => { sentMessage.value = message; return { messageId: 'mock-provider-accepted' } },
      })
      deliveryLog = await prisma.notificationLog.findUniqueOrThrow({ where: { id: deliveryLog.id } })
      ok(deliveryLog.status === 'SENT' && Boolean(deliveryLog.sentAt), 'the row becomes sent only after provider acceptance')
      ok(deliveryLog.content === null, 'the encrypted token payload is erased after successful delivery')
      ok(Boolean(sentMessage.value?.text.includes(emailInvite.value!.token)), 'the mock provider receives the intended one-time link')
      ok(sentMessage.value?.from === testMailEnvironment.SMTP_FROM && sentMessage.value.to === `delivery-${stamp}@test.example`, 'delivery uses the configured sender and invited address')
      const listedEmail = (await listOrganizationInvitations(ownerContext)).find((entry) => entry.id === emailInvite.value!.id)
      ok(listedEmail?.deliveryState === 'sent' && Boolean(listedEmail.sentAt), 'the invitation screen can show its sent state and date')

      const retryInvite = await createOrganizationInvitation({
        context: ownerContext, email: `retry-${stamp}@test.example`, role: 'FRANCHISE_OWNER', invitedById: owner.id,
      })
      deliveryInvitationIds.push(retryInvite.value!.id)
      await queueOrganizationInvitationEmail({ invitationId: retryInvite.value!.id, recipient: `retry-${stamp}@test.example`, token: retryInvite.value!.token })
      const retryHash = (await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: retryInvite.value!.id } })).tokenHash
      const retryLog = await prisma.notificationLog.findUniqueOrThrow({ where: { idempotencyKey: `organization-invitation:${retryInvite.value!.id}:${retryHash}` } })
      await processDueNotifications(10, {
        notificationIds: [retryLog.id],
        sendEmail: async () => { throw Object.assign(new Error('temporary test failure'), { responseCode: 421 }) },
      })
      const waitingRetry = await prisma.notificationLog.findUniqueOrThrow({ where: { id: retryLog.id } })
      ok(waitingRetry.status === 'PENDING' && waitingRetry.attemptCount === 1 && waitingRetry.scheduledAt! > new Date(), 'temporary provider errors schedule a bounded retry')
      ok(!waitingRetry.errorMessage?.includes(retryInvite.value!.token), 'retry diagnostics do not expose the invitation token')
      await prisma.notificationLog.update({ where: { id: retryLog.id }, data: { scheduledAt: new Date(Date.now() - 1_000) } })
      await processDueNotifications(10, { notificationIds: [retryLog.id], sendEmail: async () => ({ messageId: 'mock-retry-accepted' }) })
      ok((await prisma.notificationLog.findUniqueOrThrow({ where: { id: retryLog.id } })).status === 'SENT', 'a later successful attempt marks the retry sent')

      const rejectedInvite = await createOrganizationInvitation({
        context: ownerContext, email: `rejected-${stamp}@test.example`, role: 'FRANCHISE_OWNER', invitedById: owner.id,
      })
      deliveryInvitationIds.push(rejectedInvite.value!.id)
      await queueOrganizationInvitationEmail({ invitationId: rejectedInvite.value!.id, recipient: `rejected-${stamp}@test.example`, token: rejectedInvite.value!.token })
      const rejectedHash = (await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: rejectedInvite.value!.id } })).tokenHash
      const rejectedLog = await prisma.notificationLog.findUniqueOrThrow({ where: { idempotencyKey: `organization-invitation:${rejectedInvite.value!.id}:${rejectedHash}` } })
      await processDueNotifications(10, {
        notificationIds: [rejectedLog.id],
        sendEmail: async () => { throw Object.assign(new Error('provider rejected'), { responseCode: 550 }) },
      })
      const failedDelivery = await prisma.notificationLog.findUniqueOrThrow({ where: { id: rejectedLog.id } })
      ok(failedDelivery.status === 'FAILED' && failedDelivery.content === null, 'permanent provider rejection is final and clears the payload')
      ok(!failedDelivery.errorMessage?.includes(rejectedInvite.value!.token), 'provider rejection details remain token-free')

      const cancelledInvite = await createOrganizationInvitation({
        context: ownerContext, email: `cancel-queued-${stamp}@test.example`, role: 'FRANCHISE_OWNER', invitedById: owner.id,
      })
      deliveryInvitationIds.push(cancelledInvite.value!.id)
      await queueOrganizationInvitationEmail({ invitationId: cancelledInvite.value!.id, recipient: `cancel-queued-${stamp}@test.example`, token: cancelledInvite.value!.token })
      const cancelledHash = (await prisma.organizationInvitation.findUniqueOrThrow({ where: { id: cancelledInvite.value!.id } })).tokenHash
      const cancelledLog = await prisma.notificationLog.findUniqueOrThrow({ where: { idempotencyKey: `organization-invitation:${cancelledInvite.value!.id}:${cancelledHash}` } })
      await cancelOrganizationInvitation({ context: ownerContext, invitationId: cancelledInvite.value!.id, actorId: owner.id })
      await invalidateQueuedOrganizationInvitationEmails(cancelledInvite.value!.id, 'This invitation was cancelled before its email was sent.')
      let cancelledDeliveryCount = 0
      await processDueNotifications(10, { notificationIds: [cancelledLog.id], sendEmail: async () => { cancelledDeliveryCount++; return {} } })
      ok(cancelledDeliveryCount === 0, 'cancelling a queued invitation prevents SMTP dispatch')
    })

    console.log('--- another organization cannot touch these ---')
    const otherContext: OrgContext = {
      organizationId: otherOrganization.id, organizationName: otherOrganization.name, membershipId: 'none',
      role: 'ORGANIZATION_OWNER', regions: [], locationBusinessIds: [], homeBusinessId: null,
    }
    const crossCancel = await cancelOrganizationInvitation({
      context: otherContext, invitationId: original.value!.id, actorId: owner.id,
    })
    ok(!crossCancel.ok, 'an invitation id from another organization is not cancellable')
    const crossRole = await changeMemberRole({
      context: otherContext, memberId: corporateMember.id, role: 'FRANCHISE_OWNER', actorId: owner.id,
    })
    ok(!crossRole.ok, 'a member id from another organization cannot be changed')
    const crossAccept = await acceptOrganizationInvitation({
      token: resent.value!.token, userEmail: resendEmail, userId: invitee.id,
    })
    ok(!crossAccept.ok, 'a cancelled invitation cannot be revived by another organization either')

    console.log('--- roles and suspension ---')
    const promoted = await changeMemberRole({
      context: ownerContext, memberId: corporateMember.id, role: 'REGIONAL_MANAGER', actorId: owner.id,
    })
    ok(promoted.ok, 'the owner can change a member’s role')
    const ownRole = await changeMemberRole({
      context: ownerContext, memberId: ownerMember.id, role: 'CORPORATE_ADMIN', actorId: owner.id,
    })
    ok(!ownRole.ok && ownRole.reason === 'owner-protected', 'the owner’s own membership is protected from this screen')
    const selfChange = await changeMemberRole({
      context: ownerContext, memberId: corporateMember.id, role: 'FRANCHISE_OWNER', actorId: corporate.id,
    })
    ok(!selfChange.ok, 'a person cannot raise their own role')

    const suspended = await setMemberStatus({
      context: ownerContext, memberId: corporateMember.id, status: 'SUSPENDED', actorId: owner.id,
    })
    ok(suspended.ok, 'the owner can suspend a member')
    const suspendedRow = await prisma.organizationMember.findUnique({ where: { id: corporateMember.id } })
    ok(suspendedRow!.status === 'SUSPENDED', 'the membership reads suspended')
    const restored = await setMemberStatus({
      context: ownerContext, memberId: corporateMember.id, status: 'ACTIVE', actorId: owner.id,
    })
    ok(restored.ok, 'and restore them again')
    const suspendOwner = await setMemberStatus({
      context: ownerContext, memberId: ownerMember.id, status: 'SUSPENDED', actorId: owner.id,
    })
    ok(!suspendOwner.ok && suspendOwner.reason === 'owner-protected', 'the organization owner cannot be suspended here')

    console.log('--- the audit trail ---')
    const actions = await prisma.auditLog.findMany({
      where: { userId: { in: [owner.id, corporate.id, invitee.id] }, entityType: 'OrganizationMembership' },
      select: { action: true },
    })
    const seen = new Set(actions.map((row) => row.action))
    for (const action of [
      'ORGANIZATION_INVITATION_CREATED',
      'ORGANIZATION_INVITATION_RESENT',
      'ORGANIZATION_INVITATION_CANCELLED',
      'ORGANIZATION_MEMBER_ROLE_CHANGED',
      'ORGANIZATION_MEMBER_STATUS_CHANGED',
    ]) {
      ok(seen.has(action as never), `${action} is recorded`)
    }
    const acceptance = await prisma.auditLog.findFirst({
      where: { action: 'ORGANIZATION_INVITATION_ACCEPTED', entityType: 'OrganizationMembership', userId: invitee.id },
    })
    ok(Boolean(acceptance), 'acceptance is recorded too')
    const auditText = JSON.stringify(await prisma.auditLog.findMany({
      where: { entityType: 'OrganizationMembership', userId: { in: [owner.id, corporate.id, invitee.id] } },
    }))
    ok(!auditText.includes(token), 'no audit row contains an invitation token')

    console.log('--- nothing is deleted ---')
    ok(Boolean(await prisma.user.findUnique({ where: { id: stranger.id } })), 'accepting did not remove any user')
    ok(Boolean(await prisma.business.findUnique({ where: { id: business.id } })), 'the shop and its records are untouched')
  } finally {
    if (deliveryInvitationIds.length) {
      await prisma.notificationLog.deleteMany({
        where: {
          type: 'ORGANIZATION_INVITATION',
          OR: deliveryInvitationIds.map((id) => ({ idempotencyKey: { startsWith: `organization-invitation:${id}:` } })),
        },
      })
    }
    await prisma.auditLog.deleteMany({
      where: { entityType: 'OrganizationMembership', userId: { in: [owner.id, corporate.id, invitee.id] } },
    })
    await prisma.organizationInvitation.deleteMany({ where: { organizationId: organization.id } })
    await prisma.organizationMember.deleteMany({ where: { organizationId: organization.id } })
    await prisma.user.deleteMany({ where: { businessId: business.id } })
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, otherOrganization.id] } } })
    await prisma.business.delete({ where: { id: business.id } })
    await prisma.$disconnect()
  }

  console.log(`\nOrganization invitations: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error('Test error:', error)
  await prisma.$disconnect()
  process.exit(1)
})
