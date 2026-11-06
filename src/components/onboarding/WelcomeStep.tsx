'use client'

// Onboarding Step 1 — Welcome.
// Explains what the owner is about to configure and lets them continue.
// Purely presentational: no customer data, all copy is template copy.

import { Store, Palette, CalendarDays, ArrowRight } from 'lucide-react'

interface WelcomeStepProps {
  onNext: () => void
}

const HIGHLIGHTS = [
  {
    icon: Store,
    title: 'Business basics',
    description: 'Your shop name, web address, timezone, and contact details.',
  },
  {
    icon: Palette,
    title: 'Branding',
    description: 'Logo, colors, theme, and typography — make it yours.',
  },
  {
    icon: CalendarDays,
    title: 'Bookings',
    description: 'Everything is optional to finish later — you can come back anytime.',
  },
]

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="max-w-2xl mx-auto text-center py-8">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 border border-amber-500/30">
        <Store className="h-8 w-8 text-amber-400" />
      </div>

      <h2 className="text-2xl sm:text-3xl font-bold text-zinc-100">Welcome — let&apos;s set up your barbershop</h2>
      <p className="mt-3 text-zinc-400 max-w-lg mx-auto">
        This quick setup configures your shop: how customers find you, how it looks, and how
        bookings work. You can leave and return anytime — your progress is saved.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3 text-left">
        {HIGHLIGHTS.map((item) => (
          <div key={item.title} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
            <item.icon className="h-5 w-5 text-amber-400" />
            <h3 className="mt-3 text-sm font-semibold text-zinc-100">{item.title}</h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">{item.description}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onNext}
        className="mt-8 inline-flex items-center gap-2 rounded-md bg-amber-500 px-6 py-2.5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-amber-400"
      >
        Let&apos;s get started
        <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-3 text-xs text-zinc-500">
        Set aside a few minutes. There is no time limit, and you can stop and come back
        whenever you like.
      </p>
    </div>
  )
}
