'use client'

import Link from 'next/link'
import { CalendarDays, Clock3, Home, Users, MoreHorizontal } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const items = [
  { href: '/dashboard', label: 'Today', icon: Home },
  { href: '/dashboard/appointments', label: 'Bookings', icon: CalendarDays },
  { href: '/dashboard/schedule', label: 'Schedule', icon: Clock3 },
  { href: '/dashboard/customers', label: 'Clients', icon: Users },
  { href: '/dashboard/settings', label: 'More', icon: MoreHorizontal },
]

export function MobileBottomNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Mobile dashboard navigation" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-[var(--dash-surface)]/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href)
        return (
          <Link key={href} href={href} className={cn('flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors', active ? 'text-amber-400' : 'text-muted-foreground hover:text-foreground')} aria-current={active ? 'page' : undefined}>
            <Icon aria-hidden="true" className="size-5" />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
