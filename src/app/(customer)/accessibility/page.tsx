export const dynamic = 'force-dynamic'

import React from 'react'
import Link from 'next/link'
import { Metadata } from 'next'
import { resolveBusiness } from '@/lib/tenant'
import { Accessibility, ArrowLeft, Mail, Phone, MapPin, CheckCircle, ShieldCheck } from 'lucide-react'

export async function generateMetadata(): Promise<Metadata> {
  const business = await resolveBusiness().catch(() => null)
  const businessName = business?.name || 'Barber Shop'
  return {
    title: `Accessibility Statement | ${businessName}`,
    description: `Accessibility commitment and digital standards for ${businessName}. Learn how we ensure our website is accessible to everyone.`,
  }
}

export default async function AccessibilityStatementPage() {
  const business = await resolveBusiness().catch(() => null)

  if (!business) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Shop Not Configured</h1>
          <p className="text-muted-foreground">An administrator needs to run the setup process.</p>
        </div>
      </div>
    )
  }

  const businessName = business.name
  const businessEmail = business.email || `contact@${business.slug || 'shop'}.com`
  const businessPhone = business.phone || 'N/A'
  const businessAddress = business.address
    ? `${business.address}, ${business.city || ''}, ${business.state || ''} ${business.zipCode || ''}`.trim()
    : 'N/A'

  return (
    <div className="min-h-[calc(100vh-4rem)] py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Navigation */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center text-sm font-medium hover:opacity-80 transition-colors"
            style={{ color: business.accentColor }}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
        </div>

        {/* Header */}
        <div className="border-b pb-8 mb-10">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-3 rounded-lg border" style={{ backgroundColor: `${business.accentColor}10`, borderColor: `${business.accentColor}20`, color: business.accentColor }}>
              <Accessibility className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
                Accessibility Statement
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                {businessName} • Digital Accessibility Commitment
              </p>
            </div>
          </div>
          <p className="text-lg leading-relaxed mt-4">
            <strong style={{ color: business.accentColor }}>{businessName}</strong> is committed to improving digital accessibility for all users, including people with disabilities. We continually enhance the user experience and review the booking flow for accessibility improvements; this statement does not guarantee compliance with a particular legal standard.
          </p>
        </div>

        {/* Content Body */}
        <div className="space-y-10 text-base leading-relaxed">
          {/* Section 1 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold border-b pb-2 flex items-center gap-2" style={{ color: business.accentColor }}>
              <ShieldCheck className="w-5 h-5" /> 1. Commitment to Accessibility
            </h2>
            <p>
              We believe that the web should be available and accessible to anyone. We strive to adhere strictly to web accessibility standards and ensure our online booking system provides equal access to individuals of all abilities, regardless of assistive technology utilized.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold border-b pb-2 flex items-center gap-2" style={{ color: business.accentColor }}>
              <CheckCircle className="w-5 h-5" /> 2. Standards Followed
            </h2>
            <p>
              Our web design and development team aims to align with the <strong>Web Content Accessibility Guidelines (WCAG) 2.1 Level AA</strong> standards. These guidelines define requirements to make web content more accessible to people with visual, hearing, cognitive, and motor disabilities.
            </p>
            <p className="text-sm text-muted-foreground">
              Key accessibility implementation practices across our platform include:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Keyboard Navigation:</strong> Fully operable interface elements with standard tab focus indicators.</li>
              <li><strong>High Contrast & Aesthetic:</strong> High contrast color pairings for text elements to improve readability.</li>
              <li><strong>ARIA Labels:</strong> Screen reader attributes applied to interactive widgets, modals, and appointment selection forms.</li>
              <li><strong>Responsive Scaling:</strong> Fluid layouts that adapt without horizontal scrolling when zoomed up to 200%.</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold border-b pb-2" style={{ color: business.accentColor }}>
              3. Known Limitations & Continuous Improvement
            </h2>
            <p>
              Despite our efforts to make all content and features fully accessible, some items may occasionally undergo updates or rely on third-party dependencies (such as map widgets or external calendar tools).
            </p>
            <p>
              We continuously audit our web workflows to identify potential accessibility gaps and remedy them promptly.
            </p>
          </section>

          {/* Section 4 */}
          <section className="space-y-4 border p-6 rounded-xl mt-8" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-xl font-semibold mb-3" style={{ color: business.accentColor }}>
              4. Contact for Accessibility Issues & Assistance
            </h2>
            <p className="mb-4">
              If you experience difficulty accessing any part of our website or booking system, or if you require assistance placing a booking using assistive tools, please contact us directly:
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center space-x-3">
                <Mail className="w-4 h-4" style={{ color: business.accentColor }} />
                <span>Email: <a href={`mailto:${businessEmail}`} className="hover:underline" style={{ color: business.accentColor }}>{businessEmail}</a></span>
              </div>
              <div className="flex items-center space-x-3">
                <Phone className="w-4 h-4" style={{ color: business.accentColor }} />
                <span>Phone: {businessPhone}</span>
              </div>
              <div className="flex items-center space-x-3">
                <MapPin className="w-4 h-4" style={{ color: business.accentColor }} />
                <span>Address: {businessAddress}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              We aim to respond to accessibility inquiries within 1-2 business days and offer alternative booking solutions by telephone or in person.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
