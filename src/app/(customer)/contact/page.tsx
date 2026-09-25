export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import { resolveBusiness } from '@/lib/tenant'
import { ContactForm } from '@/components/customer/ContactForm'
import { Card } from '@/components/ui/card'
import { MapPin, Phone, Mail, Clock } from 'lucide-react'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Reveal } from '@/components/motion/reveal'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Contact Us",
    description: "Get in touch with us, find our location, view shop hours, or send us a message.",
    path: "/contact",
  })
}

export const revalidate = 60

export default async function ContactPage() {
  const business = await resolveBusiness().catch(() => null)

  const shopName = business?.name || 'Barber Shop'
  const phone = business?.phone || null
  const email = business?.email || null
  const fullAddress = [business?.address, business?.city, business?.state, business?.zipCode]
    .filter(Boolean)
    .join(', ') || null

  const hoursList = business?.hours && typeof business.hours === 'object'
    ? Object.entries(business.hours).map(([day, val]: [string, any]) => ({
        day: day.charAt(0).toUpperCase() + day.slice(1),
        hours: val?.isOff ? 'Closed' : `${val?.open || '09:00'} - ${val?.close || '18:00'}`,
      }))
    : []

  return (
    <Section className="pt-12 lg:pt-20">
      {/* Header */}
      <SectionHeading
        eyebrow="Get In Touch"
        title={`Contact ${shopName}`}
        description="Have questions about our services, walk-in availability, or custom group bookings? We are here to help."
      />

      <Reveal className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
        {/* Shop Info Card */}
        <Card className="bg-card/60 border-border/70 backdrop-blur-sm p-8 space-y-8">
          <div>
            <h2 className="text-2xl font-bold text-foreground  mb-6">Location & Information</h2>
            <div className="space-y-6">
              {fullAddress && (
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30 shrink-0">
                    <MapPin className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Address</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">{fullAddress}</p>
                  </div>
                </div>
              )}

              {phone && (
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30 shrink-0">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Phone</h3>
                    <a href={`tel:${phone.replace(/\D/g, '')}`} className="text-sm text-accent hover:underline mt-0.5 inline-block">
                      {phone}
                    </a>
                  </div>
                </div>
              )}

              {email && (
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30 shrink-0">
                    <Mail className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Email</h3>
                    <a href={`mailto:${email}`} className="text-sm text-accent hover:underline mt-0.5 inline-block">
                      {email}
                    </a>
                  </div>
                </div>
              )}

              {hoursList.length > 0 && (
                <div className="flex items-start gap-4 pt-2 border-t border-border">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30 shrink-0">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="w-full">
                    <h3 className="text-sm font-semibold text-foreground mb-3">Hours of Operation</h3>
                    <div className="space-y-1.5 text-xs">
                      {hoursList.map((item, idx) => (
                        <div key={idx} className="flex justify-between py-1 border-b border-border/60">
                          <span className="text-muted-foreground font-medium">{item.day}</span>
                          <span className="text-accent font-semibold">{item.hours}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Contact Form Card */}
        <Card className="bg-card/60 border-border/70 backdrop-blur-sm p-8 space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-foreground ">Send Us a Message</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Fill out the form below and our team will get back to you within 24 hours.
            </p>
          </div>
          <ContactForm />
        </Card>
      </Reveal>

      {/* Google Maps Embed */}
      {fullAddress && (
        <Reveal className="mt-12">
        <Card className="bg-card/60 border-border/70 backdrop-blur-sm overflow-hidden p-0 relative">
          <div className="p-6 border-b border-border flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-accent" />
              <span className="text-foreground font-semibold text-sm">{fullAddress}</span>
            </div>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${shopName} ${fullAddress}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-accent hover:underline"
            >
              Open in Google Maps &rarr;
            </a>
          </div>
          <iframe
            title="Shop Location Map"
            width="100%"
            height="350"
            style={{ border: 0, filter: 'grayscale(0.8) contrast(1.2) invert(0.9)' }}
            loading="lazy"
            allowFullScreen
            src={`https://maps.google.com/maps?q=${encodeURIComponent(`${shopName} ${fullAddress}`)}&z=15&output=embed`}
          />
        </Card>
        </Reveal>
      )}
    </Section>
  )
}
