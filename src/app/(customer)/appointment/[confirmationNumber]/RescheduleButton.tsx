'use client'

// ============================================================================
// Token-flow wrapper around the shared RescheduleFlow. Keeps the historical
// public token contract (POST /api/public/appointments/[token]/reschedule)
// while sharing the accessible date/time picker with the customer portal.
// ============================================================================

import RescheduleFlow from '@/components/customer/RescheduleFlow'

interface Props {
  token: string
  serviceId: string
  barberId: string
  currentStartTime: string
}

export default function RescheduleButton({ token, serviceId, barberId, currentStartTime }: Props) {
  return (
    <RescheduleFlow
      serviceId={serviceId}
      barberId={barberId}
      currentStartTime={currentStartTime}
      buttonLabel="Reschedule Appointment"
      submit={async (startTime) => {
        const response = await fetch(`/api/public/appointments/${encodeURIComponent(token)}/reschedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startTime }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to reschedule.')
        return { startTime: data.startTime }
      }}
    />
  )
}
