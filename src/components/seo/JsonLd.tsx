import React from 'react'
import StructuredData from './StructuredData'

export interface JsonLdProps {
  scripts: Array<{
    type?: 'LocalBusiness' | 'Service' | 'FAQPage' | 'BreadcrumbList' | 'WebSite'
    data: Record<string, unknown>
  }>
}

export function JsonLd({ scripts }: JsonLdProps) {
  if (!scripts || !Array.isArray(scripts) || scripts.length === 0) return null

  return (
    <>
      {scripts.map((script, index) => (
        <StructuredData key={index} type={script.type} data={script.data} />
      ))}
    </>
  )
}

export default JsonLd
