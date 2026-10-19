import type { Metadata } from 'next'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { resolveBusiness } from '@/lib/tenant'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: 'Cookie Policy',
    description: 'Learn how this website uses cookies and similar technologies.',
    path: '/cookies',
  })
}

export default async function CookiePolicyPage() {
  const business = await resolveBusiness().catch(() => null)

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
      <div className="space-y-3">
        <Badge variant="outline" className="border-accent/40 text-accent">Legal &amp; Compliance</Badge>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Cookie Policy</h1>
        <p className="text-xs text-muted-foreground">Last reviewed: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</p>
      </div>

      <Card className="space-y-6 border-border bg-card p-8 text-sm leading-relaxed text-foreground/70">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">How cookies are used</h2>
          <p>
            {business?.name || 'This website'} uses strictly necessary cookies to keep authenticated sessions secure and support booking and customer-portal functionality.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">What is not used by this template</h2>
          <p>
            The template does not set advertising or analytics cookies. If a shop adds a third-party analytics, advertising, chat, or similar service, its use and any required choices must be documented by the shop before it is enabled.
          </p>
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">Managing cookies</h2>
          <p>
            Necessary cookies cannot be disabled through this website without affecting sign-in, booking, or portal features. Browser settings can block or delete cookies, but doing so may prevent these features from working.
          </p>
        </section>
        <p className="border-t border-border pt-6 text-muted-foreground">
          This page describes the template&apos;s current behavior and is not legal advice. Shop owners should review it with qualified counsel and update it when integrations or tracking practices change.
        </p>
      </Card>
    </div>
  )
}
