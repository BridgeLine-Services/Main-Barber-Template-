/**
 * scripts/reset-first-owner.ts
 * ============================================================================
 * EXPLICIT RECOVERY PROCEDURE — reopens self-service first-owner registration.
 *
 * Background: the self-service first-owner flow (/login → Create Owner
 * Account) closes automatically once an OWNER exists. If a deployment was
 * bootstrapped with a placeholder owner (e.g. the earlier token-gated
 * provisioning path), the site administrator can use this script to retire
 * that account so the real owner can register themselves from the website.
 *
 * Safety properties (all must hold — the script refuses otherwise):
 *   • Interactive only: never runs from a deployment hook or CI.
 *   • Verifies the owner's CURRENT PASSWORD against the stored bcrypt hash
 *     before doing anything — possession of the credentials is proof of
 *     administrator authority over that account.
 *   • Only deletes the specified OWNER user — nothing else.
 *   • Refuses when the owner has completed onboarding (businessId set or a
 *     Business exists): that shop has real data; use the in-app ownership
 *     transfer instead of deleting the account.
 *   • Prints an audit trail of what it did.
 *
 * Usage (run from the repo root, against the target DATABASE_URL):
 *   DATABASE_URL="postgresql://…" npx tsx scripts/reset-first-owner.ts \
 *     --email owner@yourbarbershop.com
 *   (password is read interactively, never from argv or the environment)
 * ============================================================================
 */

import { createInterface } from 'readline'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma'

function fail(message: string): never {
  console.error(`❌ ${message}`)
  process.exit(1)
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) }))
}

async function main() {
  const args = process.argv.slice(2)
  const emailIdx = args.indexOf('--email')
  const email = emailIdx !== -1 ? args[emailIdx + 1]?.trim().toLowerCase() : undefined
  if (!email) {
    fail('Usage: npx tsx scripts/reset-first-owner.ts --email <owner-email>  (reads the password interactively)')
  }

  if (process.env.CI || process.env.VERCEL) {
    fail('Refusing to run inside CI or a deployment environment — this is an interactive administrator recovery tool.')
  }

  const owner = await prisma.user.findUnique({ where: { email } })
  if (!owner) fail(`No account found for ${email}.`)
  if (owner.role !== 'OWNER') {
    fail(`Account ${email} has role ${owner.role}, not OWNER. This tool only retires OWNER accounts.`)
  }

  const businesses = await prisma.business.count()
  const hasBusiness = owner.businessId !== null || businesses > 0
  if (hasBusiness) {
    fail(
      'This owner has completed onboarding (a business exists). Deleting the account would orphan shop data. ' +
      'Use the in-app flow instead: invite your email as staff, promote to co-owner, transfer ownership.'
    )
  }

  console.log(`\n⚠️  Recovery target: OWNER ${email} (id ${owner.id})`)
  console.log('   This will PERMANENTLY delete this user account so first-owner')
  console.log('   registration reopens on the website. Nothing else is touched.\n')

  const password = await prompt('Enter the CURRENT password of this owner account: ')
  if (!password) fail('No password provided.')
  const ok = await bcrypt.compare(password, owner.passwordHash)
  if (!ok) {
    fail('Password does not verify against the stored hash. Aborting — nothing was changed.')
  }

  const confirmed = await prompt(`Type the email ${email} again to confirm deletion: `)
  if (confirmed.toLowerCase() !== email) fail('Confirmation did not match. Aborting — nothing was changed.')

  await prisma.user.delete({ where: { id: owner.id } })

  console.log(`\n✅ Deleted OWNER account ${email} (id ${owner.id}) at ${new Date().toISOString()}.`)
  console.log('   First-owner registration is now OPEN on /login.')
  console.log('   The next visitor to select "Create Owner Account" becomes the owner.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
