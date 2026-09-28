// E2E helper: marks the seeded business's onboarding as complete (test DB only).
// The public booking site is gated on onboardingCompleted; the seed intentionally
// leaves it false so a fresh client copy boots into the white-label onboarding wizard.
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const r = await prisma.business.updateMany({
    where: { onboardingCompleted: false },
    data: { onboardingCompleted: true, onboardingCompletedAt: new Date(), onboardingStep: 'done' },
  })
  console.log('onboarding completed for', r.count, 'business(es)')
}
main().finally(() => prisma.$disconnect())
