import { redirect } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle2, CircleAlert, ArrowRight, Rocket, Building2, Palette, Scissors, Users, Clock3, CalendarCheck, Search, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { prisma } from '@/lib/prisma'
import { requireOwner } from '@/lib/auth-helpers'
import { verifyFactoryLaunch } from '@/lib/factory-launch'

const setupSections = [
  { category: 'Client', label: 'Business', description: 'Name, contact details, address, timezone, and public identity.', href: '/dashboard/settings?tab=business', icon: Building2 },
  { category: 'Branding', label: 'Branding', description: 'Logo, colors, images, and the visual system for the public site.', href: '/dashboard/settings?tab=branding', icon: Palette },
  { category: 'Services', label: 'Services', description: 'Your menu, pricing, durations, and active offerings.', href: '/dashboard/services', icon: Scissors },
  { category: 'Team', label: 'Barbers', description: 'Staff profiles, service assignments, and active team members.', href: '/dashboard/barbers', icon: Users },
  { category: 'Schedule', label: 'Schedules', description: 'Working hours, breaks, closures, and availability.', href: '/dashboard/schedule', icon: Clock3 },
  { category: 'Booking', label: 'Booking & policies', description: 'Booking rules, cancellation policy, and customer instructions.', href: '/dashboard/settings?tab=booking', icon: CalendarCheck },
  { category: 'SEO', label: 'SEO & social', description: 'Search metadata, local details, and social preview information.', href: '/dashboard/settings?tab=seo', icon: Search },
  { category: 'Testing', label: 'Launch review', description: 'Environment, database, domain, and final acceptance checks.', href: '/dashboard/factory-launch', icon: ShieldCheck },
]

export default async function SetupPage() {
  const auth = await requireOwner()
  if (!auth.success) redirect('/login')
  const user = await prisma.user.findUnique({ where: auth.user.id ? { id: auth.user.id } : { email: auth.user.email }, select: { businessId: true } })
  if (!user?.businessId) redirect('/dashboard/onboarding')

  const report = await verifyFactoryLaunch(user.businessId)
  const getSectionChecks = (category: string) => report.checks.filter((check) => check.category === category)
  const sectionStatus = (category: string) => {
    const checks = getSectionChecks(category)
    if (checks.some((check) => check.status === 'BLOCKED')) return 'Needs attention'
    if (checks.some((check) => check.status === 'WARNING' || check.status === 'MANUAL')) return 'Review'
    return 'Complete'
  }
  const completeCount = setupSections.filter((section) => sectionStatus(section.category) === 'Complete').length
  const next = report.nextAction

  return (
    <main className="mx-auto max-w-6xl pb-12">
      <div className="flex flex-col gap-6">
        <section className="rounded-2xl border border-border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-2xl">
              <Badge variant="secondary" className="mb-3">Client setup</Badge>
              <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Get your shop ready to launch.</h1>
              <p className="mt-3 text-muted-foreground">Configure the essentials in one place. Your progress is saved to this client&apos;s database, so you can pause and return anytime.</p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3">
              <Rocket className="size-5 text-primary" />
              <div><p className="text-2xl font-semibold leading-none">{completeCount}/{setupSections.length}</p><p className="mt-1 text-xs text-muted-foreground">sections complete</p></div>
            </div>
          </div>
          <div className="mt-7 h-2 overflow-hidden rounded-full bg-muted" aria-label={`${completeCount} of ${setupSections.length} sections complete`}>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((completeCount / setupSections.length) * 100)}%` }} />
          </div>
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div><CardTitle>Recommended next step</CardTitle><CardDescription>{next.detail}</CardDescription></div>
            <Button asChild><Link href={next.category === 'Environment' || next.category === 'Domain' ? '/dashboard/factory-launch' : '/dashboard/onboarding'}>Continue setup <ArrowRight data-icon="inline-end" /></Link></Button>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2">
          {setupSections.map((section) => {
            const status = sectionStatus(section.category)
            const complete = status === 'Complete'
            const Icon = section.icon
            return <Card key={section.label} className="transition-colors hover:border-primary/40">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"><Icon className="size-5 text-primary" /></div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{section.label}</h2><Badge variant={complete ? 'default' : 'outline'}>{complete ? <CheckCircle2 data-icon="inline-start" /> : <CircleAlert data-icon="inline-start" />}{status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{section.description}</p><Button asChild variant="link" className="mt-2 h-auto px-0"><Link href={section.href}>{complete ? 'Review section' : 'Configure section'} <ArrowRight data-icon="inline-end" /></Link></Button></div>
              </CardContent>
            </Card>
          })}
        </section>
      </div>
    </main>
  )
}
