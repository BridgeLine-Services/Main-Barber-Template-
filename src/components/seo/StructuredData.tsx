import React from 'react'

export interface StructuredDataProps {
  type?: 'LocalBusiness' | 'Service' | 'FAQPage' | 'BreadcrumbList' | 'WebSite'
  data: Record<string, unknown>
}

export function StructuredData({ data }: StructuredDataProps) {
  if (!data) return null

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export default StructuredData
