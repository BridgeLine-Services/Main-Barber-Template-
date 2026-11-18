/**
 * Review invite copy tests (Part 6).
 *
 * The panel added this round tells an owner what happened to each review invitation.
 * These assertions pin the two things that could quietly mislead them: a stored status
 * must never surface as a raw enum, and "could not send" must never read like something
 * is fine.
 */

import {
  describeReviewInviteHealth,
  describeReviewRequestStatus,
} from '../src/lib/review-invite-copy'

let passed = 0
let failed = 0

function check(name: string, condition: boolean) {
  if (condition) {
    passed++
    console.log(`  ✅ ${name}`)
  } else {
    failed++
    console.log(`  ❌ ${name}`)
  }
}

console.log('── Every stored status has owner words ──')
const statuses = ['PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SUPPRESSED', 'CANCELLED']
for (const status of statuses) {
  const copy = describeReviewRequestStatus(status)
  check(`${status} has a label`, copy.label.length > 0)
  check(`${status} label is not the enum`, copy.label !== status && !/^[A-Z_]+$/.test(copy.label))
  check(`${status} explains itself`, copy.detail.length > 10)
}

console.log('\n── Attention is only claimed where it is real ──')
check('FAILED needs attention', describeReviewRequestStatus('FAILED').needsAttention === true)
check('SENT does not need attention', describeReviewRequestStatus('SENT').needsAttention === false)
check('PENDING does not need attention', describeReviewRequestStatus('PENDING').needsAttention === false)
check(
  'SUPPRESSED does not need attention (opt-out is normal)',
  describeReviewRequestStatus('SUPPRESSED').needsAttention === false
)
check(
  'an unknown status is honest rather than silent',
  describeReviewRequestStatus('SOMETHING_NEW').label === 'Not recognised'
)

console.log('\n── The one-liner matches the actual state ──')
const health = (over: Partial<Parameters<typeof describeReviewInviteHealth>[0]>) =>
  describeReviewInviteHealth({
    enabled: true,
    destinationConfigured: true,
    sent: 0,
    pending: 0,
    failed: 0,
    ...over,
  })

check('switched off says so', /switched off/i.test(health({ enabled: false })))
check(
  'missing review link says so',
  /review link/i.test(health({ destinationConfigured: false }))
)
check('never sent says so', /no invites/i.test(health({})))
check('failures are named', /could not be sent/i.test(health({ sent: 3, failed: 1 })))
check('normal operation does not alarm', !/could not|switch/i.test(health({ sent: 4 })))
check(
  'a switched-off shop is never told invites are going out',
  !/going out automatically/i.test(health({ enabled: false, sent: 10 }))
)

console.log(`\nReview invite copy: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
