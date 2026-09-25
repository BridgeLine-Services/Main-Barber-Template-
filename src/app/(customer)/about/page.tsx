export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { getInitials } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Section, SectionHeading } from '@/components/customer/Section'
import { BookButton } from '@/components/customer/Cta'
import { Reveal, Stagger, StaggerItem } from '@/components/motion/reveal'
import { ShieldCheck, Heart, Award } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "About Us",
    description: "Learn about our history, master barbers, values, and dedication to classic barbering excellence.",
    path: "/about",
  })
}

export const revalidate = 60

export default async function AboutPage() {
  let business = null
  let barbers: any[] = []

  try {
    business = await resolveBusiness()
    if (business) {
      barbers = await prisma.barber.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: { order: 'asc' },
      })
    }
  } catch (error) {
    console.error('Failed to load about page data:', error)
  }

  const shopName = business?.name || 'Barber Shop'

  return (
    <Section className="pt-12 lg:pt-20">
      {/* Hero / About Story */}
      <SectionHeading
        eyebrow="Our Story"
        title={`About ${shopName}`}
        description={business?.aboutText ||
          `${shopName} was founded with a single mission: to combine classic barbering traditions with modern styling precision. We create a welcoming environment where every haircut is an experience in refinement and confidence.`}
      />

      {/* Core Values Section */}
      <section className="mt-16 lg:mt-24 space-y-10">
        <SectionHeading
          eyebrow="Why Choose Us"
          title="Our Standard of Excellence"
        />

        <Stagger className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <StaggerItem>
          <Card className="bg-card/60 border-border/70 backdrop-blur-sm p-6 space-y-4 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent border border-accent/30">
              <Award className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground ">Master Craftsmanship</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Every barber on our team is a seasoned professional trained in razor line-ups, skin fades, taper cuts, and beard sculpting.
            </p>
          </Card>
          </StaggerItem>

          <StaggerItem>
          <Card className="bg-card/60 border-border/70 backdrop-blur-sm p-6 space-y-4 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent border border-accent/30">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground ">Sanitation & Hygiene</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We uphold strict hygiene protocols. All tools are sterilized between clients, ensuring a safe and pristine grooming environment.
            </p>
          </Card>
          </StaggerItem>

          <StaggerItem>
          <Card className="bg-card/60 border-border/70 backdrop-blur-sm p-6 space-y-4 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent border border-accent/30">
              <Heart className="h-6 w-6" />
            </div>
            <h3 className="text-xl font-bold text-foreground ">Hassle-Free Booking</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              No app download or online payment required. Reserve your time slot in 60 seconds and pay in person when your cut is finished.
            </p>
          </Card>
          </StaggerItem>
        </Stagger>
      </section>

      {/* Team Section */}
      {barbers.length > 0 && (
        <section className="mt-16 lg:mt-24 space-y-10">
          <SectionHeading
            eyebrow="The Crew"
            title="Meet the Artisans Behind the Chair"
          />

          <Stagger className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {barbers.map((barber) => (
              <StaggerItem key={barber.id}>
              <Card className="bg-card/60 border-border/70 backdrop-blur-sm p-6 text-center space-y-4 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-xl hover:shadow-black/20">
                <Avatar className="h-24 w-24 mx-auto border-2 border-accent/40 ring-4 ring-zinc-950">
                  {barber.photo && <AvatarImage src={barber.photo} alt={barber.name} />}
                  <AvatarFallback className="bg-secondary text-accent font-bold text-xl">
                    {getInitials(barber.name)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="text-xl font-bold text-foreground ">{barber.name}</h3>
                  {barber.specialty && (
                    <p className="text-xs text-accent font-semibold mt-0.5">{barber.specialty}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed italic">
                  {barber.bio || 'Passionate about classic barbering and providing legendary client service.'}
                </p>
                <div className="pt-2">
                  <Button
                    asChild
                    size="sm"
                    className="bg-secondary hover:bg-accent hover:text-accent-foreground text-foreground/80 font-semibold w-full"
                  >
                    <Link href={`/book?barberId=${barber.id}`}>Book with {barber.name.split(' ')[0]}</Link>
                  </Button>
                </div>
              </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </section>
      )}

      {/* CTA */}
      <Reveal className="mt-16 lg:mt-24">
        <section className="rounded-2xl bg-card/60 border border-border/70 backdrop-blur-sm p-8 sm:p-12 text-center space-y-6">
          <h2 className="text-3xl font-bold text-foreground">Experience the Difference</h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-sm">
            Join hundreds of satisfied clients who trust us for their grooming needs. Reserve your appointment today.
          </p>
          <BookButton href="/book" label="Book Your Haircut" />
        </section>
      </Reveal>
    </Section>
  )
}
