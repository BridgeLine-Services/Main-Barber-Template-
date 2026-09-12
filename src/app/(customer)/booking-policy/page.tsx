export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { resolveBusiness } from '@/lib/tenant'
import { Button } from '@/components/ui/button'
import { Calendar, Clock, AlertTriangle, CheckCircle2, ShieldCheck } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Booking Policy",
    description: "Learn about our booking, rescheduling, cancellation, and late arrival policies.",
    path: "/booking-policy",
  })
}

export const revalidate = 60

export default async function BookingPolicyPage() {
  let business = null

  try {
    business = await resolveBusiness()
  } catch (error) {
    console.error('Failed to load business policies:', error)
  }

  const customBookingPolicy = business?.bookingPolicy
  const customCancellationPolicy = business?.cancellationPolicy

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-10">
      <div className="space-y-3 text-center sm:text-left">
        <Badge variant="outline" className="border-accent/40 text-accent">
          Shop Guidelines
        </Badge>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground ">
          Booking & Cancellation Policy
        </h1>
        <p className="text-muted-foreground text-base leading-relaxed">
          Please review our shop policies before scheduling your appointment to ensure a seamless experience for all clients.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Custom Business Policies if present */}
        {customBookingPolicy && (
          <Card className="bg-card border-border p-8 space-y-4">
            <h2 className="text-xl font-bold text-foreground  flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-accent" />
              Custom Booking Guidelines
            </h2>
            <p className="text-sm text-foreground/70 whitespace-pre-line leading-relaxed">
              {customBookingPolicy}
            </p>
          </Card>
        )}

        {customCancellationPolicy && (
          <Card className="bg-card border-border p-8 space-y-4">
            <h2 className="text-xl font-bold text-foreground  flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-accent" />
              Custom Cancellation Guidelines
            </h2>
            <p className="text-sm text-foreground/70 whitespace-pre-line leading-relaxed">
              {customCancellationPolicy}
            </p>
          </Card>
        )}

        {/* Standard Policy Content */}
        <Card className="bg-card border-border p-8 space-y-8 text-foreground/70 text-sm leading-relaxed">
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30">
                <Calendar className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold text-foreground ">1. How Online Booking Works</h2>
            </div>
            <p>
              Our online scheduling system allows you to reserve a guaranteed chair time with your preferred barber in under 60 seconds. No app download or upfront credit card payment is required.
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>Select your desired service and preferred barber.</li>
              <li>Choose an available date and time slot.</li>
              <li>Provide your name, phone number, and email address for instant confirmation.</li>
              <li>Pay in person at the shop after your appointment.</li>
            </ul>
          </section>

          <section className="space-y-3 pt-6 border-t border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30">
                <Clock className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold text-foreground ">2. Rescheduling & Cancellation</h2>
            </div>
            <p>
              We understand plans change! If you need to cancel or reschedule your appointment, we ask that you do so at least <strong className="text-accent">2 hours prior</strong> to your start time.
            </p>
            <p className="text-muted-foreground">
              You can modify or cancel your booking using the manage link in your email confirmation, or by calling the shop directly.
            </p>
          </section>

          <section className="space-y-3 pt-6 border-t border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold text-foreground ">3. Late Arrival & No-Show Policy</h2>
            </div>
            <ul className="list-disc pl-5 space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground/80">Grace Period:</strong> We offer a 10-minute grace period. If you arrive more than 10 minutes late, we may need to shorten your service duration or reschedule your appointment to remain on schedule for subsequent clients.
              </li>
              <li>
                <strong className="text-foreground/80">No-Shows:</strong> Clients who fail to show up without prior notification twice may be restricted from using our online self-booking system for future appointments.
              </li>
            </ul>
          </section>

          <section className="space-y-3 pt-6 border-t border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold text-foreground ">4. Walk-in Policy</h2>
            </div>
            <p>
              Walk-ins are welcomed based on barber availability between scheduled appointments. However, online appointments take priority. To avoid waiting times, we always encourage booking online in advance.
            </p>
          </section>
        </Card>

        {/* Action Button */}
        <div className="text-center pt-4">
          <Button asChild size="lg" className="bg-accent hover:brightness-110 text-zinc-950 font-bold px-8">
            <Link href="/book">I Understand — Book Now</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
