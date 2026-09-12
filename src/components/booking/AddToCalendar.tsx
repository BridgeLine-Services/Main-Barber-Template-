'use client'

import { Button } from '@/components/ui/button'
import { CalendarPlus, Globe } from 'lucide-react'

interface AddToCalendarProps {
  serviceName: string
  barberName: string
  startTime: string
  endTime: string
  businessName?: string
  businessAddress?: string
  businessPhone?: string
  businessTimezone?: string
}

function formatDateForICS(date: string): string {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function generateICS(props: AddToCalendarProps): string {
  const { serviceName, barberName, startTime, endTime, businessName, businessAddress, businessPhone, businessTimezone } = props
  const start = formatDateForICS(startTime)
  const end = formatDateForICS(endTime)
  const title = `${serviceName} with ${barberName}`
  const location = businessAddress || ''
  const description = [
    `${serviceName} with ${barberName}`,
    businessPhone ? `Call shop: ${businessPhone}` : '',
  ].filter(Boolean).join('\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BarberShop//Booking//EN',
    `X-WR-TIMEZONE:${businessTimezone || 'UTC'}`,
    'BEGIN:VEVENT',
    `UID:${Date.now()}@barbershop`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
    location ? `LOCATION:${location}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

function downloadICS(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function generateGoogleCalendarUrl(props: AddToCalendarProps): string {
  const { serviceName, barberName, startTime, endTime, businessName, businessAddress, businessPhone } = props
  const start = new Date(startTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const end = new Date(endTime).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const title = encodeURIComponent(`${serviceName} with ${barberName}`)
  const details = encodeURIComponent(`${businessPhone ? `Call shop: ${businessPhone}` : ''}`)
  const location = encodeURIComponent(businessAddress || '')

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`
}

export function AddToCalendar(props: AddToCalendarProps) {
  const handleICS = () => {
    const ics = generateICS(props)
    downloadICS(ics, `${props.serviceName}-appointment.ics`)
  }

  const handleGoogle = () => {
    window.open(generateGoogleCalendarUrl(props), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3 justify-center">
      <Button
        onClick={handleICS}
        variant="outline"
        className="border-accent/30 text-amber-100 hover:bg-accent/10 hover:border-accent/50"
      >
        <CalendarPlus className="w-4 h-4 mr-2" /> Add to Apple Calendar
      </Button>
      <Button
        onClick={handleGoogle}
        variant="outline"
        className="border-accent/30 text-amber-100 hover:bg-accent/10 hover:border-accent/50"
      >
        <Globe className="w-4 h-4 mr-2" /> Add to Google Calendar
      </Button>
    </div>
  )
}
