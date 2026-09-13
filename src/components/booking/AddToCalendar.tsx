'use client'

import { CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AddToCalendarProps {
  /** The customer's appointment access token — authorizes the export server-side. */
  token: string
}

/**
 * "Add to Calendar" action for the confirmation experience.
 *
 * Downloads a standards-compliant .ics file generated server-side at
 * /api/public/appointments/[token]/calendar — gated by the same access
 * token as every other customer appointment action. No OAuth, no external
 * calendar APIs; the file works with Google Calendar, Apple Calendar,
 * Outlook, and any RFC 5545 client.
 */
export function AddToCalendar({ token }: AddToCalendarProps) {
  const href = `/api/public/appointments/${encodeURIComponent(token)}/calendar`

  return (
    <Button asChild>
      <a href={href} download>
        <CalendarPlus className="mr-2 h-4 w-4" />
        Add to Calendar
      </a>
    </Button>
  )
}
