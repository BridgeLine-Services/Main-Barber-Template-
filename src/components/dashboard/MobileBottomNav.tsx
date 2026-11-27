'use client'

import Link from 'next/link'
import { CalendarDays, Clock3, Home, Users, MoreHorizontal } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const ownerItems = [
  { href: '/dashboard', label: 'Today', icon: Home },
  { href: '/dashboard/appointments', label: 'Bookings', icon: CalendarDays },
  { href: '/dashboard/calendar', label: 'Calendar', icon: Clock3 },
  { href: '/dashboard/customers', label: 'Clients', icon: Users },
  { href: '/dashboard/settings', label: 'More', icon: MoreHorizontal },
]

const barberItems = [
  { href: '/dashboard', label: 'Today', icon: Home },
  { href: '/dashboard/appointments', label: 'My bookings', icon: CalendarDays },
  { href: '/dashboard/schedule', label: 'Schedule', icon: Clock3 },
  { href: '/dashboard/my-commissions', label: 'Pay', icon: Users },
  { href: '/dashboard/profile', label: 'Profile', icon: MoreHorizontal },
]

const managerItems = [
  ...barberItems.slice(0, 3),
  { href: '/dashboard/organization', label: 'Locations', icon: Users },
  { href: '/dashboard/organization/announcements', label: 'Updates', icon: MoreHorizontal },
]

export function MobileBottomNav({
  userRole = 'BARBER',
  organizationRole,
}: {
  userRole?: string
  organizationRole?: string | null
}) {
  const pathname = usePathname()
  const items = userRole === 'OWNER' || userRole === 'BUSINESS_ADMIN'
    ? ownerItems
    : organizationRole === 'LOCATION_MANAGER' ? managerItems : barberItems
  return (
    <nav aria-label="Mobile dashboard navigation" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-[var(--dash-surface)]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
        return (
          <Link key={href} href={href} className={cn('flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors', active ? 'text-[var(--dash-brand)]' : 'text-muted-foreground hover:text-foreground')} aria-current={active ? 'page' : undefined}>
            <Icon aria-hidden="true" className="size-5" />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
