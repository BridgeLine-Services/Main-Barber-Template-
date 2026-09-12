export const dynamic = 'force-dynamic'
import { generatePageMetadata } from '@/lib/generate-page-metadata'

import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { resolveBusiness } from '@/lib/tenant'

export async function generateMetadata(): Promise<Metadata> {
  return generatePageMetadata({
    titleSuffix: "Privacy Policy",
    description: "Our privacy policy details how we collect, use, and protect your personal information.",
    path: "/privacy",
  })
}

export default async function PrivacyPolicyPage() {
  const business = await resolveBusiness().catch(() => null)
  const customPolicy = business?.privacyPolicy

  if (customPolicy) {
    return (
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-8">
        <div className="space-y-3">
          <Badge variant="outline" className="border-accent/40 text-accent">Legal & Compliance</Badge>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
          <p className="text-xs text-muted-foreground">Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}</p>
        </div>
        <Card className="bg-card border-border p-8 text-foreground/70 space-y-6 text-sm leading-relaxed">
          <div className="whitespace-pre-wrap">{customPolicy}</div>
        </Card>
        <Card className="bg-card border-border p-6 text-foreground/70 space-y-3 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-foreground">Necessary cookies</h2>
          <p>
            This website may use strictly necessary cookies to keep staff sessions secure and support booking or portal functionality. These cookies are not used for advertising or analytics and cannot be disabled through this website without affecting core features.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16 space-y-8">
      <div className="space-y-3">
        <Badge variant="outline" className="border-accent/40 text-accent">
          Legal & Compliance
        </Badge>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
      </div>

      <Card className="bg-card border-border p-8 text-foreground/70 space-y-4 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold text-foreground">Policy not available</h2>
        <p>
          This business has not published a privacy policy yet. Please contact the shop directly if you have questions about how your information is handled.
        </p>
        <p className="text-muted-foreground">
          Business owners should review and customize this policy for their location and services before publishing it.
        </p>
      </Card>
      <Card className="bg-card border-border p-6 text-foreground/70 space-y-3 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold text-foreground">Necessary cookies</h2>
        <p>
          This website may use strictly necessary cookies to keep staff sessions secure and support booking or portal functionality. These cookies are not used for advertising or analytics.
        </p>
      </Card>

    </div>
  )
}
