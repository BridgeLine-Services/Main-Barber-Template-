import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { CustomerPortal } from '@/components/customer/CustomerPortal'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams: Promise<{ shop?: string }> }

export default async function PortalPage({ searchParams }: PageProps) {
  const params = await searchParams
  let business: any = null
  try {
    business = params.shop
      ? await prisma.business.findUnique({ where: { slug: params.shop } })
      : await resolveBusiness()
  } catch {
    business = null
  }

  if (!business) {
    return <div className="mx-auto max-w-7xl px-4 py-16 text-center"><h1 className="mb-4 text-4xl font-extrabold text-foreground ">Shop Not Found</h1><p className="text-sm text-muted-foreground">This shop has not been set up yet. Please check your link and try again.</p></div>
  }

  const hours = business.hours as Record<string, { open?: string; close?: string; isOff?: boolean }> | null
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

  return (
    <>
      <CustomerPortal businessId={business.id} businessName={business.name} />
      <div className="mx-auto max-w-7xl px-4 py-12 lg:py-16">
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-foreground  sm:text-5xl">{business.name}</h1>
          <p className="text-base text-muted-foreground">{business.address}, {business.city}, {business.state} {business.zipCode}</p>
          <p className="mt-2 text-base text-muted-foreground">{business.phone}</p>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-8">
            <h2 className="mb-6 text-xl font-bold text-foreground ">Business Hours</h2>
            <div className="space-y-2">{days.map((day) => { const dayHours = hours?.[day]; return <div key={day} className="flex items-center justify-between text-sm"><span className="capitalize text-foreground/70">{day}</span><span className={dayHours?.isOff || !dayHours?.open ? 'text-muted-foreground' : 'text-foreground/80'}>{dayHours?.isOff || !dayHours?.open ? 'Closed' : `${dayHours.open} - ${dayHours.close}`}</span></div> })}</div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-8">
            <h2 className="mb-6 text-xl font-bold text-foreground ">Our Services</h2>
            <p className="text-sm text-muted-foreground">Visit our booking page to see available services and schedule an appointment.</p>
            <a href="/book" className="mt-6 inline-flex rounded-lg bg-accent px-6 py-3 text-sm font-bold text-zinc-950 transition-colors hover:brightness-110">Book Appointment</a>
          </div>
        </div>
      </div>
    </>
  )
}
