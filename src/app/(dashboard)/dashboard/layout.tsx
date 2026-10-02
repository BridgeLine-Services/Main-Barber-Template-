import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { generateDashboardThemeCSS, DASH_THEME_CLASS } from '@/lib/dashboard-theme'
import { checkDashboardAccess } from '@/lib/onboarding'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { MobileBottomNav } from '@/components/dashboard/MobileBottomNav'
import { ExternalLink } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getServerSession(authOptions)

  // Server-side access gate (cannot be bypassed by client navigation).
  // Priority: login → forced password change → onboarding → dashboard.
  const pathname = (await headers()).get('x-pathname') || '/dashboard'
  const access = await checkDashboardAccess(session, pathname)
  if (!access.allowed && access.redirectTo) {
    redirect(access.redirectTo)
  }

  const user = session!.user as { id?: string; email?: string; name?: string; businessName?: string; role?: string }
  const identityWhere = user.id ? { id: user.id } : user.email ? { email: user.email } : null
  const dbUser = identityWhere
    ? await prisma.user.findUnique({
        where: identityWhere,
        select: { businessId: true, role: true },
      })
    : null
  const businessId = dbUser?.businessId ?? null
  const userRole = dbUser?.role || user.role || 'BARBER'

  let business = null
  try {
    if (businessId) {
      business = await prisma.business.findUnique({
        where: { id: businessId },
        select: {
          name: true, logo: true, primaryColor: true, accentColor: true,
          secondaryColor: true, fontFamily: true,
          websiteContent: { select: { visualPreset: true, publishedContent: true } },
        },
      })
    }
  } catch (error) {
    console.error('Failed to load business data:', error)
  }

  const businessName = business?.name || user.businessName || 'Barber Shop'
  const userName = user.name || user.email || 'User'

  // Brand identity: the PUBLISHED visual preset is the source of truth;
  // fall back to the live draft column before the first publish (same parity
  // rule as the public site). Custom business accent/font win over preset
  // defaults so client branding is never clobbered.
  const wc: { visualPreset?: string | null; publishedContent?: unknown } | null =
    (business as { websiteContent?: { visualPreset?: string | null; publishedContent?: unknown } | null } | null)?.websiteContent ?? null
  const published = (wc?.publishedContent ?? null) as { visualPreset?: unknown } | null
  const preset =
    typeof published?.visualPreset === 'string'
      ? published.visualPreset
      : wc?.visualPreset ?? null
  const dashThemeCSS = generateDashboardThemeCSS({
    visualPreset: preset,
    accentColor: business?.accentColor ?? null,
    secondaryColor: business?.secondaryColor ?? null,
    primaryColor: business?.primaryColor ?? null,
    fontFamily: business?.fontFamily ?? null,
  })

  return (
    <div className={`min-h-screen bg-background text-foreground flex flex-col lg:flex-row ${DASH_THEME_CLASS}`}>
      <style dangerouslySetInnerHTML={{ __html: dashThemeCSS }} />
      {/* Sidebar Component */}
      <Sidebar
        userName={userName}
        userRole={userRole}
        businessName={businessName}
      />

      {/* Main Content Workspace */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Desktop Header */}
        <header className="hidden lg:flex items-center justify-between px-8 py-4 bg-[var(--dash-header)] border-b border-border sticky top-0 z-30">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground [font-family:var(--dash-display-font)]">{businessName}</h1>
            <p className="text-xs text-muted-foreground">Shop Management Portal</p>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-[var(--dash-brand-border)] hover:text-[var(--dash-brand)]"
            >
              View Customer Website
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="text-right">
              <p className="text-sm font-medium text-foreground">{userName}</p>
              <span className="inline-block text-[11px] font-semibold text-[var(--dash-brand)] bg-[var(--dash-brand-soft)] border border-[var(--dash-brand-border)] px-2 py-0.5 rounded-full capitalize">
                {userRole.toLowerCase()}
              </span>
            </div>
            <div className="w-9 h-9 rounded-full bg-[var(--dash-brand-soft)] border border-[var(--dash-brand-border)] flex items-center justify-center text-[var(--dash-brand)] font-bold text-sm">
              {userName[0]?.toUpperCase() || 'U'}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-x-hidden bg-background p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-8">
          {children}
        </main>
        <MobileBottomNav />
      </div>
    </div>
  )
}
