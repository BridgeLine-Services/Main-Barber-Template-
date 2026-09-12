export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { HelpCircle } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Frequently Asked Questions",
    description: "Find answers to common questions about booking, payments, cancellations, parking, and shop policies.",
    path: "/faq",
  })
}

// Fallback FAQs shown only if the owner hasn't added any yet via the dashboard.
const DEFAULT_FAQS = [
  {
    category: 'Booking & Appointments',
    questions: [
      {
        q: 'How do I book an appointment?',
        a: 'You can easily book online in under 60 seconds through our website. Select your desired service, choose your preferred barber (or first available), pick a date and time, and enter your contact details. You will receive an instant confirmation.',
      },
      {
        q: 'Can I choose a specific barber?',
        a: 'Yes! When booking online, you can browse all active barbers, view their specialties and availability, and choose your favorite. If you have no preference, select "First Available Barber".',
      },
      {
        q: 'How far in advance can I book?',
        a: 'Appointments can be booked up to 30 days in advance online. For advance group bookings or special events, please contact us directly.',
      },
      {
        q: 'Can I reschedule or cancel my appointment?',
        a: 'Yes. If you need to reschedule or cancel, please provide at least 2 hours advance notice using your confirmation link or by calling us directly.',
      },
    ],
  },
  {
    category: 'Payments & Pricing',
    questions: [
      {
        q: 'Do I need to enter a credit card to book?',
        a: 'No! We do not require or collect online payments. You pay in person at the shop after your appointment is completed.',
      },
      {
        q: 'What payment methods do you accept at the shop?',
        a: 'We accept Cash, Debit Cards, Credit Cards (Visa, MasterCard, American Express), Apple Pay, Google Pay, and contactless tap payments.',
      },
    ],
  },
  {
    category: 'Shop Info & Policies',
    questions: [
      {
        q: 'Do you accept walk-ins?',
        a: 'Yes! Walk-ins are always welcome based on chair availability. However, we strongly recommend booking an appointment online to guarantee your preferred time slot with zero wait time.',
      },
      {
        q: 'What happens if I run late?',
        a: 'If you are running more than 10 minutes late, please call us. We will do our best to accommodate you, but may need to adjust your service duration to keep the schedule on time for other clients.',
      },
    ],
  },
]

export default async function FAQPage() {
  const business = await resolveBusiness().catch(() => null)

  let categories: { category: string; questions: { q: string; a: string }[] }[] = DEFAULT_FAQS

  if (business) {
    const faqs = await prisma.faq.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }],
    })

    if (faqs.length > 0) {
      const grouped = new Map<string, { q: string; a: string }[]>()
      for (const faq of faqs) {
        if (!grouped.has(faq.category)) grouped.set(faq.category, [])
        grouped.get(faq.category)!.push({ q: faq.question, a: faq.answer })
      }
      categories = Array.from(grouped.entries()).map(([category, questions]) => ({ category, questions }))
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-12">
      {/* Header */}
      <div className="text-center space-y-4">
        <Badge variant="outline" className="border-accent/40 text-accent px-3 py-1">
          Help Center
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-display font-semibold text-foreground tracking-tight">
          Frequently Asked Questions
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed max-w-2xl mx-auto">
          Have a question about booking, payments, or shop policies? Find quick answers below.
        </p>
      </div>

      {/* FAQ Sections */}
      <div className="space-y-10">
        {categories.map((cat, idx) => (
          <div key={idx} className="space-y-4">
            <h2 className="text-xl font-bold text-accent  flex items-center gap-2 border-b border-border pb-2">
              <HelpCircle className="h-5 w-5" />
              {cat.category}
            </h2>

            <div className="space-y-3">
              {cat.questions.map((item, qIdx) => (
                <details
                  key={qIdx}
                  className="group rounded-xl bg-card border border-border p-5 [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex cursor-pointer items-center justify-between text-base font-semibold text-foreground group-open:text-accent transition">
                    <span>{item.q}</span>
                    <span className="ml-2 shrink-0 text-accent font-bold text-xl group-open:rotate-45 transition-transform">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-sm text-foreground/70 leading-relaxed pl-1 border-l-2 border-accent/40">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Need More Help Banner */}
      <Card className="bg-card border-border p-8 text-center space-y-4">
        <h3 className="text-xl font-bold text-foreground ">Still Have Questions?</h3>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          If you couldn't find the answer you were looking for, feel free to give us a call or send us a message directly.
        </p>
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button asChild className="bg-accent hover:brightness-110 text-accent-foreground font-bold">
            <Link href="/contact">Contact Us</Link>
          </Button>
          <Button asChild variant="outline" className="border-accent/30 text-foreground hover:bg-accent/10 hover:border-accent/50">
            <Link href="/book">Book Appointment</Link>
          </Button>
        </div>
      </Card>
    </div>
  )
}
