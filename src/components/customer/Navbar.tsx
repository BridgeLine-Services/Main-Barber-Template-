'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Scissors, Menu, X, Calendar, Phone } from 'lucide-react'

interface NavbarProps {
  businessName?: string
  logo?: string | null
  phone?: string | null
}

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/barbers', label: 'Barbers' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
]

export function Navbar({ businessName = 'Barber Shop', logo, phone }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()

  // Transparent over the hero, solid + blurred once the user scrolls.
  // Passive listener + no layout reads → no scroll jank.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={
        'sticky top-0 z-40 w-full transition-all duration-300 ' +
        (scrolled
          ? 'border-b border-border/70 bg-background/90 shadow-lg shadow-black/10 backdrop-blur-md'
          : 'border-b border-transparent bg-transparent')
      }
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo / Shop Name */}
        <Link href="/" className="flex items-center gap-2.5 transition hover:opacity-90">
          {logo ? (
            <img src={logo} alt={businessName} className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
              <Scissors className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <span className="font-display text-lg font-semibold tracking-tight text-foreground">
            {businessName}
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium" aria-label="Main">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={
                  'relative transition-colors hover:text-accent ' +
                  (isActive ? 'text-accent' : 'text-foreground/80')
                }
              >
                {link.label}
                <span
                  className={
                    'absolute -bottom-1.5 left-1/2 h-px -translate-x-1/2 bg-accent transition-all duration-300 ' +
                    (isActive ? 'w-full' : 'w-0')
                  }
                  aria-hidden="true"
                />
              </Link>
            )
          })}
        </nav>

        {/* Desktop CTA & Phone */}
        <div className="hidden md:flex items-center gap-4">
          {phone && (
            <a
              href={`tel:${phone.replace(/\D/g, '')}`}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-accent"
            >
              <Phone className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <span>{phone}</span>
            </a>
          )}
          <Link
            href="/book"
            className="inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-sm shadow-accent/20 transition-all duration-300 hover:brightness-110 hover:-translate-y-0.5"
          >
            <Calendar className="h-4 w-4" aria-hidden="true" />
            Book Now
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <div className="flex items-center gap-2 md:hidden">
          <Link
            href="/book"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground"
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            Book
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="rounded-md p-2 text-foreground/80 transition hover:bg-card hover:text-foreground"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown Nav — smooth expand/collapse */}
      <AnimatePresence initial={false}>
        {mobileMenuOpen && (
          <motion.nav
            key="mobile-nav"
            aria-label="Mobile"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.21, 0.47, 0.32, 0.98] }}
            className="overflow-hidden border-b border-border bg-background/95 backdrop-blur-md md:hidden"
          >
            <div className="space-y-1 px-4 pb-6 pt-2">
              {NAV_LINKS.map((link) => {
                const isActive = pathname === link.href
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      'block rounded-md px-3 py-2.5 text-base font-medium transition ' +
                      (isActive
                        ? 'border border-accent/30 bg-accent/10 text-accent'
                        : 'text-foreground/80 hover:bg-card hover:text-foreground')
                    }
                  >
                    {link.label}
                  </Link>
                )
              })}
              {phone && (
                <div className="mt-3 border-t border-border/60 px-3 pt-3">
                  <a
                    href={`tel:${phone.replace(/\D/g, '')}`}
                    className="flex items-center gap-2 py-1 text-sm text-muted-foreground transition hover:text-accent"
                  >
                    <Phone className="h-4 w-4 text-accent" aria-hidden="true" />
                    <span>Call Us: {phone}</span>
                  </a>
                </div>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
