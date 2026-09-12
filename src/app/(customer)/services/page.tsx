export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { formatDuration, formatPrice } from '@/lib/utils'
import { PAYMENT_DISCLAIMER } from '@/lib/constants'
import { resolveBusiness } from '@/lib/tenant'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, CreditCard, Scissors } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Services & Pricing",
    description: "View our full service menu and prices. Book your appointment online and pay in person.",
    path: "/services",
  })
}

export const revalidate = 60

export default async function ServicesPage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Shop Not Configured</h1>
          <p className="text-muted-foreground">An administrator needs to run the setup process.</p>
        </div>
      </div>
    )
  }

  const services = await prisma.service.findMany({
    where: { businessId: business.id, isActive: true },
    orderBy: { order: 'asc' },
  })

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-12">
      {/* Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <Badge variant="outline" className="border-accent/40 text-accent px-3 py-1">
          Service Menu
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-display font-semibold text-foreground tracking-tight">
          Barbering Services & Pricing
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          From classic precision haircuts to luxury beard sculpting and hot towel shaves. All services include consultation and style finishing.
        </p>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {services.map((service) => (
          <Card key={service.id} className="bg-card border-border hover:border-border transition flex flex-col justify-between group">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl text-foreground font-bold group-hover:text-accent transition-colors">
                    {service.name}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs flex items-center gap-1.5 mt-1.5">
                    <Clock className="h-3.5 w-3.5 text-accent" />
                    {formatDuration(service.duration)}
                  </CardDescription>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-black text-accent">
                    {formatPrice(service.price)}
                  </div>
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
                    Pay in Person
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="text-sm text-foreground/70 py-3 leading-relaxed flex-1">
              {service.description || 'Professional barbering service tailored to your style preferences.'}
            </CardContent>

            <CardFooter className="pt-4 border-t border-border/60">
              <Button
                asChild
                className="w-full bg-accent hover:brightness-110 text-accent-foreground font-bold transition shadow-sm"
              >
                <Link href={`/book?serviceId=${service.id}`}>Book This Service</Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      {/* Payment Disclaimer Banner */}
      <div className="rounded-xl bg-card/90 border border-border p-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30 shrink-0">
            <CreditCard className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">In-Person Payment Notice</p>
            <p className="text-xs text-muted-foreground mt-0.5">{PAYMENT_DISCLAIMER}</p>
          </div>
        </div>
        <Button
          asChild
          variant="outline"
          className="border-border bg-card text-foreground/80 hover:bg-secondary hover:text-foreground shrink-0"
        >
          <Link href="/book">Reserve Time Slot</Link>
        </Button>
      </div>
    </div>
  )
}
