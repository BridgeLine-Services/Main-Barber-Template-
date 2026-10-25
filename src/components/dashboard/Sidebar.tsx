'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

import {
  LayoutDashboard,
  Calendar,
  CalendarDays,
  Users,
  Scissors,
  Clock,
  UserCog,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ChevronDown,
  Shield,
  User,ScrollText,
  CalendarOff,
  Gift,
  Repeat,
  BarChart3,
  Package,
  ShoppingCart,
  Megaphone,
  CalendarX,
  UserX,
  Star,
  Image as ImageIcon,
  UserCircle,
  Globe,
  Palette,
  FileText,
  Search,
  Smartphone,
  Activity,
  Rocket,
  ArrowLeftRight,
  BadgePercent,
  Wallet,
  Building2,
  Monitor,
  Eye,
  LayoutGrid,
  Type,
  ListOrdered,
  HelpCircle,
  AlertTriangle,
  MonitorSmartphone,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { signOut } from 'next-auth/react'
import type { LucideIcon } from 'lucide-react'
import { roleLabel } from '@/lib/role-labels'

interface SidebarProps {
  userName: string
  userRole: string
  businessName: string
}

interface NavItem {
  name: string
  href: string
  icon: LucideIcon
}

/** A collapsible sub-group inside a section (e.g. Website → Branding). */
interface NavGroup {
  label: string
  items: NavItem[]
}

interface NavSection {
  label: string
  /** Flat items rendered directly under the section header. */
  items?: NavItem[]
  /** Collapsible sub-groups rendered after the flat items. */
  groups?: NavGroup[]
}

export function Sidebar({ userName, userRole, businessName }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Section AND group open/closed state. A container the user has explicitly
  // toggled is remembered here; containers without a user choice follow auto
  // behavior (open when they contain the active route, closed otherwise).
  // The user's explicit choice always wins over route-based auto-expansion,
  // so a direct link to a nested page expands its parents until the user
  // collapses them.
  const [sectionState, setSectionState] = useState<Record<string, 'open' | 'closed'>>({})
  const [groupState, setGroupState] = useState<Record<string, 'open' | 'closed'>>({})

  // Owner nav is shared with BUSINESS_ADMIN — real authorization is server-side
  // (page gates + API guards); the sidebar only controls visibility.
  const isOwner = userRole === 'OWNER' || userRole === 'BUSINESS_ADMIN'

  // Settings tab links (?tab=) must match BOTH the route and the tab. When
  // /dashboard/settings is visited without a tab the page falls back to its
  // default tab ('business') — mirror that so the right child highlights.
  const activeSettingsTab = searchParams.get('tab') ?? 'business'

  // ─── Active-route calculation (single authoritative matcher) ─────────
  const isItemActive = (href: string) => {
    if (href.includes('?tab=')) {
      const [path, query] = href.split('?')
      if (pathname !== path) return false
      const tab = new URLSearchParams(query).get('tab')
      return activeSettingsTab === tab
    }
    if (href === '/dashboard') return pathname === '/dashboard'
    // A nav item that is the parent of another nav item (e.g. Online Shop is
    // the parent of Shop Orders) matches exactly, so the child page never
    // double-highlights it. Everything else exact-matches or prefix-matches
    // whole segments (nested routes like /dashboard/gallery/hero keep the
    // Gallery parent highlighted, which has no nav item of its own).
    if (parentHrefs.has(href)) return pathname === href
    return pathname === href || pathname.startsWith(href + '/')
  }

  const isExpanded = (
    stateMap: Record<string, 'open' | 'closed'>,
    key: string,
    hasActive: boolean,
  ) => {
    if (stateMap[key] === 'open') return true
    if (stateMap[key] === 'closed') return false
    return hasActive // auto behavior: follow the active route until chosen
  }

  // Toggle based on the EFFECTIVE state so the first click on an auto-closed
  // container opens it, and the first click on an auto-expanded one closes it.
  // Toggling never navigates or changes the current page.
  const toggleExpanded = (
    setter: React.Dispatch<React.SetStateAction<Record<string, 'open' | 'closed'>>>,
    stateMap: Record<string, 'open' | 'closed'>,
    key: string,
    hasActive: boolean,
  ) => {
    setter({ ...stateMap, [key]: isExpanded(stateMap, key, hasActive) ? 'closed' : 'open' })
  }

  // ─── Owner nav: Overview / Website / System ────────────────────────────
  const ownerSections: NavSection[] = [
    {
      label: 'overview',
      items: [
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { name: 'Setup Checklist', href: '/dashboard/setup', icon: Rocket },
        { name: 'Barber Mode', href: '/barber-mode', icon: Smartphone },
        { name: 'Daily Ops', href: '/dashboard/operations', icon: Activity },
        { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar },
        { name: 'Appointments', href: '/dashboard/appointments', icon: CalendarDays },
        { name: 'Customers', href: '/dashboard/customers', icon: Users },
        { name: 'Barbers', href: '/dashboard/barbers', icon: UserCircle },
        { name: 'Services', href: '/dashboard/services', icon: Scissors },
        { name: 'Reviews', href: '/dashboard/reviews', icon: Star },
        { name: 'Waitlist', href: '/dashboard/waitlist', icon: Users },
      ],
    },
    {
      label: 'website',
      groups: [
        {
          label: 'Branding',
          items: [
            { name: 'Branding & Theme', href: '/dashboard/settings?tab=branding', icon: Palette },
            { name: 'Website Appearance', href: '/dashboard/settings?tab=appearance', icon: Monitor },
            { name: 'Site Preview', href: '/dashboard/website-preview', icon: Eye },
            { name: 'Layout & Behavior', href: '/dashboard/settings?tab=layout', icon: LayoutGrid },
            { name: 'Typography', href: '/dashboard/settings?tab=typography', icon: Type },
            { name: 'Homepage Sections', href: '/dashboard/settings?tab=homepage-sections', icon: ListOrdered },
            { name: 'Dashboard Preview', href: '/dashboard/settings?tab=dashboard-preview', icon: MonitorSmartphone },
          ],
        },
        {
          label: 'Business Info',
          items: [
            { name: 'Business Info', href: '/dashboard/settings?tab=business', icon: Building2 },
            { name: 'Business Hours', href: '/dashboard/settings?tab=hours', icon: Clock },
            { name: 'Social Links', href: '/dashboard/settings?tab=social', icon: Globe },
            { name: 'Policies', href: '/dashboard/settings?tab=policies', icon: FileText },
            { name: 'SEO', href: '/dashboard/settings?tab=seo', icon: Search },
            { name: 'FAQ', href: '/dashboard/settings?tab=faq', icon: HelpCircle },
            { name: 'Website Content', href: '/dashboard/settings?tab=website', icon: FileText },
            { name: 'Booking Questions', href: '/dashboard/settings?tab=booking', icon: HelpCircle },
            { name: 'Review Requests', href: '/dashboard/settings?tab=reviews', icon: Star },
          ],
        },
        {
          label: 'Shop Gallery',
          items: [
            { name: 'Logo', href: '/dashboard/gallery/logo', icon: Star },
            { name: 'Hero Image', href: '/dashboard/gallery/hero', icon: ImageIcon },
            { name: 'Shop Photos', href: '/dashboard/gallery/shop-photos', icon: ImageIcon },
            { name: 'Gallery', href: '/dashboard/gallery', icon: ImageIcon },
            { name: 'Barber Photos', href: '/dashboard/gallery/barber-photos', icon: UserCircle },
            { name: 'Barber Portfolio', href: '/dashboard/gallery/barber-portfolio', icon: ImageIcon },
            { name: 'Service Photos', href: '/dashboard/gallery/service-photos', icon: ImageIcon },
            { name: 'OG Image', href: '/dashboard/gallery/og-image', icon: ImageIcon },
            { name: 'Favicon', href: '/dashboard/gallery/favicon', icon: ImageIcon },
            { name: 'Photos', href: '/dashboard/media', icon: ImageIcon },
            { name: 'Before & After', href: '/dashboard/before-after', icon: ArrowLeftRight },
          ],
        },
      ],
    },
    {
      label: 'system',
      items: [
        { name: 'Recurring', href: '/dashboard/recurring', icon: Repeat },
        { name: 'Audit Log', href: '/dashboard/audit-log', icon: ScrollText },
        { name: 'Deactivate', href: '/dashboard/settings?tab=danger-zone', icon: AlertTriangle },
        { name: 'Launch Console', href: '/dashboard/factory-launch', icon: Shield },
        { name: 'Factory Status', href: '/dashboard/factory-status', icon: Shield },
      ],
      groups: [
        {
          label: 'Staff',
          items: [
            { name: 'Staff', href: '/dashboard/staff', icon: UserCog },
            { name: 'Commissions', href: '/dashboard/commissions', icon: BadgePercent },
            { name: 'Payroll', href: '/dashboard/payroll', icon: Wallet },
          ],
        },
        {
          label: 'Shop',
          items: [
            { name: 'Time Clock', href: '/dashboard/time-clock', icon: Clock },
            { name: 'Analytics', href: '/dashboard/analytics', icon: BarChart3 },
            { name: 'Marketing', href: '/dashboard/marketing', icon: Megaphone },
            { name: 'Loyalty', href: '/dashboard/loyalty', icon: Gift },
            { name: 'Closures', href: '/dashboard/closures', icon: CalendarOff },
            { name: 'Inventory', href: '/dashboard/inventory', icon: Package },
            { name: 'Cancellations', href: '/dashboard/cancellations', icon: CalendarX },
            { name: 'No-Shows', href: '/dashboard/no-shows', icon: UserX },
          ],
        },
        {
          label: 'Store',
          items: [
            { name: 'Gift Cards', href: '/dashboard/gift-cards', icon: Wallet },
            { name: 'Online Shop', href: '/dashboard/ecommerce', icon: ShoppingCart },
            { name: 'Shop Orders', href: '/dashboard/ecommerce/orders', icon: Package },
          ],
        },
      ],
    },
  ]

  // ─── Barber nav: focused on self-management ───────────────────────────
  const barberSections: NavSection[] = [
    {
      label: 'my dashboard',
      items: [
        { name: 'Barber Mode', href: '/barber-mode', icon: Smartphone },
        { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
        { name: 'Calendar', href: '/dashboard/calendar', icon: Calendar },
        { name: 'My Appointments', href: '/dashboard/appointments', icon: CalendarDays },
      ],
    },
    {
      label: 'my profile',
      items: [
        { name: 'Profile', href: '/dashboard/profile', icon: UserCog },
        { name: 'Schedule', href: '/dashboard/schedule', icon: Clock },
        { name: 'Closures', href: '/dashboard/closures', icon: CalendarOff },
        { name: 'Services', href: '/dashboard/services', icon: Scissors },
        { name: 'Portfolio / My Work', href: '/dashboard/portfolio', icon: ImageIcon },
        { name: 'My Commissions', href: '/dashboard/my-commissions', icon: BadgePercent },
        { name: 'My Time Clock', href: '/dashboard/my-time-clock', icon: Clock },
        { name: 'My Payroll', href: '/dashboard/my-payroll', icon: BadgePercent },
      ],
    },
  ]

  const sections = isOwner ? ownerSections : barberSections

  // Nav destinations that are a URL-prefix of ANOTHER nav destination
  // (e.g. /dashboard/ecommerce → /dashboard/ecommerce/orders) must match
  // EXACTLY, otherwise visiting the child also highlights the parent.
  const allNavHrefs = sections.flatMap((sec) => [
    ...(sec.items ?? []).map((i) => i.href),
    ...(sec.groups ?? []).flatMap((g) => g.items.map((i) => i.href)),
  ])
  const parentHrefs = new Set(
    allNavHrefs.filter(
      (h) => !h.includes('?') && allNavHrefs.some((o) => o !== h && o.startsWith(h + '/'))
    )
  )

  const closeMobile = () => setMobileOpen(false)

  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    const isActive = isItemActive(item.href)
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={closeMobile}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors group relative border',
          isActive
            ? 'bg-[var(--dash-brand-soft)] text-foreground border-[var(--dash-brand-border)] shadow-sm'
            : 'text-muted-foreground hover:text-foreground hover:bg-[var(--dash-hover)] border-transparent'
        )}
      >
        <Icon
          className={cn(
            'w-4 h-4 shrink-0',
            isActive ? 'text-[var(--dash-brand)]' : 'text-muted-foreground group-hover:text-foreground'
          )}
        />
        <span className="flex-1">{item.name}</span>
        {isActive && (
          <>
            <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r bg-[var(--dash-brand)]" />
            <ChevronRight className="w-3.5 h-3.5 text-[var(--dash-brand)]" />
          </>
        )}
      </Link>
    )
  }

  const renderGroup = (sectionLabel: string, group: NavGroup) => {
    const hasActive = group.items.some((item) => isItemActive(item.href))
    const key = `${sectionLabel}:${group.label}`
    const show = isExpanded(groupState, key, hasActive)
    return (
      <div key={key} className="mb-1.5">
        <button
          type="button"
          onClick={() => toggleExpanded(setGroupState, groupState, key, hasActive)}
          aria-expanded={show}
          aria-label={`${group.label} section ${show ? 'expanded' : 'collapsed'}`}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
        >
          <ChevronDown
            className={cn('w-3 h-3 transition-transform', show ? '' : '-rotate-90')}
          />
          {group.label}
        </button>
        {show && (
          <div className="space-y-0.5 mt-0.5 pl-2 border-l border-border/60 ml-1">
            {group.items.map(renderItem)}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Mobile Top Bar */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[var(--dash-surface)] border-b border-border text-foreground sticky top-0 z-50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[var(--dash-brand-soft)] border border-[var(--dash-brand-border)] text-[var(--dash-brand)] flex items-center justify-center">
            <Scissors className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground leading-tight">{businessName}</h2>
            <p className="text-[10px] text-muted-foreground">{roleLabel(userRole)} portal</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="text-muted-foreground hover:text-foreground hover:bg-[var(--dash-hover)]"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          'fixed top-0 bottom-0 left-0 z-50 w-64 bg-[var(--dash-surface)] border-r border-border flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Brand Header */}
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--dash-brand-soft)] border border-[var(--dash-brand-border)] text-[var(--dash-brand)] flex items-center justify-center shrink-0 shadow-sm">
              <Scissors className="w-5 h-5" />
            </div>
            <div className="overflow-hidden">
              <h1 className="text-sm font-semibold tracking-tight text-foreground truncate [font-family:var(--dash-display-font)]">{businessName}</h1>
              <p className="text-xs text-[var(--dash-brand)] font-medium">
                {isOwner ? 'Owner Dashboard' : 'Barber Portal'}
              </p>
            </div>
          </div>
          <button
            onClick={closeMobile}
            className="lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation — Grouped Sections */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {sections.map((section) => {
            const sectionItems = section.items ?? []
            const sectionGroups = section.groups ?? []
            const hasActive =
              sectionItems.some((item) => isItemActive(item.href)) ||
              sectionGroups.some((g) => g.items.some((item) => isItemActive(item.href)))
            const show = isExpanded(sectionState, section.label, hasActive)

            return (
              <div key={section.label} className="mb-1">
                {/* Section Header */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(setSectionState, sectionState, section.label, hasActive)}
                  aria-expanded={show}
                  aria-label={`${section.label} section ${show ? 'expanded' : 'collapsed'}`}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                >
                  <ChevronDown
                    className={cn('w-3 h-3 transition-transform', show ? '' : '-rotate-90')}
                  />
                  {section.label}
                </button>

                {show && (
                  <div className="mt-0.5">
                    {/* Flat section items */}
                    {sectionItems.length > 0 && (
                      <div className="space-y-0.5 mb-1">
                        {sectionItems.map(renderItem)}
                      </div>
                    )}
                    {/* Collapsible sub-groups */}
                    {sectionGroups.map((group) => renderGroup(section.label, group))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* User Info & Logout Footer */}
        <div className="p-4 border-t border-border bg-[var(--dash-surface-2)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center text-foreground text-sm font-semibold">
              {userName ? userName[0].toUpperCase() : 'U'}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="text-sm font-medium text-foreground truncate">{userName}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {isOwner ? (
                  <span className="inline-flex items-center gap-1 text-[var(--dash-brand)] font-medium">
                    <Shield className="w-3 h-3" /> Owner
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <User className="w-3 h-3" /> Barber
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full bg-muted hover:bg-red-950/30 text-foreground hover:text-red-400 border-border hover:border-red-900/50 justify-start gap-2 h-9 text-xs transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 text-muted-foreground hover:text-red-400" />
            <span>Sign Out</span>
          </Button>
        </div>
      </aside>
    </>
  )
}
