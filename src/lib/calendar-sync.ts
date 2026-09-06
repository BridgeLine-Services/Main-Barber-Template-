// ============================================================================
// Calendar Synchronization
// Generates iCal (.ics) feeds for appointments and supports Google Calendar import
// ============================================================================

/**
 * Format a Date to iCal UTC format: YYYYMMDDTHHMMSSZ
 */
function toICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Escape text for iCal format
 */
function escapeICal(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Generate an iCal feed for a business's appointments
 * This can be subscribed to via Google Calendar, Apple Calendar, Outlook, etc.
 */
export function generateICalFeed(
  businessName: string,
  appointments: Array<{
    confirmationNumber: string
    startTime: Date
    endTime: Date
    status: string
    customer: { firstName: string; lastName: string }
    barber: { name: string } | null
    service: { name: string; duration: number } | null
  }>,
  businessTimezone = 'UTC'
): string {
  const now = toICalDate(new Date())
  const calName = escapeICal(businessName)
  const prodId = `//Barber Booking System//${calName}//EN`

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + prodId,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${calName} Appointments`,
    `X-WR-TIMEZONE:${escapeICal(businessTimezone)}`,
  ]

  for (const apt of appointments) {
    if (apt.status === 'CANCELLED' || apt.status === 'NO_SHOW') continue

    const uid = `${apt.confirmationNumber}@barber-booking`
    const dtStart = toICalDate(apt.startTime)
    const dtEnd = toICalDate(apt.endTime)
    const summary = `${apt.service?.name || 'Appointment'} — ${apt.customer.firstName} ${apt.customer.lastName}`
    const description = [
      `Customer: ${apt.customer.firstName} ${apt.customer.lastName}`,
      apt.barber ? `Barber: ${apt.barber.name}` : null,
      apt.service ? `Service: ${apt.service.name} (${apt.service.duration} min)` : null,
      `Confirmation: ${apt.confirmationNumber}`,
      `Status: ${apt.status}`,
    ].filter(Boolean).join('\\n')

    const dtStamp = toICalDate(new Date())

    ics.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${escapeICal(summary)}`,
      `DESCRIPTION:${description}`,
      `STATUS:${apt.status === 'CONFIRMED' ? 'CONFIRMED' : 'TENTATIVE'}`,
      `CATEGORIES:${apt.service?.name || 'Appointment'}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Appointment reminder',
      'TRIGGER:-PT1H',
      'END:VALARM',
      'END:VEVENT'
    )
  }

  ics.push('END:VCALENDAR')
  return ics.join('\r\n')
}

/**
 * Generate a single .ics event for one appointment
 * Used for the "Add to Calendar" button on the customer confirmation page
 */
export function generateSingleICalEvent(appointment: {
  confirmationNumber: string
  startTime: Date
  endTime: Date
  customer: { firstName: string; lastName: string }
  barber: { name: string } | null
  service: { name: string; duration: number } | null
  business: { name: string; address?: string | null; city?: string | null; timezone?: string | null }
}): string {
  const dtStart = toICalDate(appointment.startTime)
  const dtEnd = toICalDate(appointment.endTime)
  const now = toICalDate(new Date())
  const uid = `${appointment.confirmationNumber}@barber-booking`

  const location = [
    appointment.business.name,
    appointment.business.address,
    appointment.business.city,
  ].filter(Boolean).join(', ')

  const summary = `${appointment.service?.name || 'Appointment'} with ${appointment.barber?.name || 'Barber'}`
  const description = [
    `Customer: ${appointment.customer.firstName} ${appointment.customer.lastName}`,
    `Service: ${appointment.service?.name || 'N/A'}`,
    `Confirmation: ${appointment.confirmationNumber}`,
  ].join('\\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Barber Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICal(summary)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeICal(location)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Appointment reminder',
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}
