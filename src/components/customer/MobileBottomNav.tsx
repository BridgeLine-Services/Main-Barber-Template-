'use client'

// Mobile bottom navigation with three owner-selectable center actions:
//  - appointment: prominent "Book" CTA (default)
//  - walk-in:     "Walk In" action joining the live queue (only offered when
//                 the business actually welcomes walk-ins)
//  - barber:      "Barbers" action leading to team profiles
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Scissors, Calendar, Phone, Users, User } from 'lucide-react'
import type { MobileNavMode } from '@/lib/visual-config'

export function MobileBottomNav({
  mode = 'appointment',
  walkInsWelcome = true,
}: {
  mode?: MobileNavMode
  walkInsWelcome?: boolean
}) {
  const pathname = usePathname()

  // Center action follows the owner's chosen mobile nav mode; walk-in only
  // appears when the queue is actually open to walk-ins.
  const centerAction: { href: string; label: string; icon: typeof Home } =
    mode === 'walk-in' && walkInsWelcome
      ? { href: '/queue', label: 'Walk In', icon: Users }
      : mode === 'barber'
        ? { href: '/barbers', label: 'Barbers', icon: User }
        : { href: '/book', label: 'Book', icon: Calendar }

  type NavItem = { href: string; label: string; icon: typeof Home; highlight?: boolean }
  const items: NavItem[] = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/services', label: 'Services', icon: Scissors },
    { ...centerAction, highlight: true },
    { href: '/contact', label: 'Contact', icon: Phone },
  ]

  return (
    <nav className="sticky-bottom-nav border-t border-border bg-background/95 backdrop-blur-md px-2 py-2 text-muted-foreground">
      <div className="flex w-full items-center justify-around">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href

          if (item.highlight) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center justify-center gap-1 rounded-xl bg-accent px-4 py-1.5 text-accent-foreground font-semibold shadow-md shadow-accent/20 active:scale-95 transition"
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-bold tracking-tight">{item.label}</span>
              </Link>
            )
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-3 transition-colors ${
                isActive ? 'text-accent font-medium' : 'text-muted-foreground hover:text-foreground/80'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px]">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
