export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { BrandSetupWizard } from '@/components/dashboard/BrandSetupWizard'

/**
 * Brand setup: a guided start for owners who do not want to guess.
 *
 * Read-only on the way in. The only change this page can make is through the
 * existing settings save plus the existing publish step, which the wizard calls
 * explicitly. Appearance, drafts and publishing are otherwise untouched.
 */
export default async function BrandSetupPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')

  const user = await prisma.user.findUnique({
    where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email },
    select: { businessId: true },
  })
  if (!user?.businessId) redirect('/dashboard/onboarding')

  const content = await prisma.websiteContent.findUnique({
    where: { businessId: user.businessId },
    select: { visualPreset: true },
  })

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wider text-[var(--dash-brand)]">Website</p>
        <h1 className="mt-2 text-3xl font-bold text-foreground">Choose your look</h1>
        <p className="mt-2 text-muted-foreground">
          Answer five questions and we will suggest a look that fits the shop. You can compare all eight and pick
          any of them, and you can change it again at any time.
        </p>
      </div>
      <BrandSetupWizard currentStyle={content?.visualPreset ?? null} />
    </div>
  )
}
