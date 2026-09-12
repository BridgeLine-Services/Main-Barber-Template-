'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function CancelButton({
  confirmationNumber,
  token,
}: {
  confirmationNumber: string
  token: string
}) {
  const [isCancelling, setIsCancelling] = useState(false)
  const router = useRouter()

  const handleCancel = async () => {
    if (!confirm('Are you sure you want to cancel this appointment?')) return
    setIsCancelling(true)

    try {
      const res = await fetch(`/api/public/appointments/${token}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Cancelled by customer' }),
      })

      const data = await res.json()

      if (data.success) {
        router.refresh()
      } else {
        alert(data.error || 'Failed to cancel. Please try again or call the shop.')
      }
    } catch (err) {
      alert('Failed to cancel. Please try again or call the shop.')
    } finally {
      setIsCancelling(false)
    }
  }

  return (
    <Button
      variant="outline"
      onClick={handleCancel}
      disabled={isCancelling}
      className="border-destructive/30 text-destructive hover:bg-destructive/10 w-full sm:w-auto"
    >
      <Trash2 className="mr-2 h-4 w-4" />
      {isCancelling ? 'Cancelling...' : 'Cancel Appointment'}
    </Button>
  )
}
