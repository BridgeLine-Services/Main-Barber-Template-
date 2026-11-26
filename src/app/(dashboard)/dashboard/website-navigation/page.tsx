export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth-helpers'
import { prisma } from '@/lib/prisma'
import { parseNavigation } from '@/lib/website-navigation'
import { WebsiteNavigationEditor } from '@/components/dashboard/WebsiteNavigationEditor'

/**
 * The website menu. The list has been stored in WebsiteContent since the first version and
 * nothing read it; this is the screen that writes it, and the public site now renders it.
 */
export default async function WebsiteNavigationPage() {
  const auth = await requireAuth()
  if (!auth.success) redirect('/login')

  const content = await prisma.websiteContent
    .findUnique({ where: { businessId: auth.user.businessId }, select: { navigation: true } })
    .catch(() => null)

  const links = parseNavigation(content?.navigation)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Website menu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The links across the top of your public site. With no menu of your own, the site uses its
          standard one.
        </p>
      </header>
      <WebsiteNavigationEditor initialLinks={links} />
    </div>
  )
}
