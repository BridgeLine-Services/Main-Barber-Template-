export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { resolveBusiness } from '@/lib/tenant'
import { formatFullDate, formatTime, formatDuration, formatPrice } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CheckCircle, Calendar, Clock, User, Scissors, ArrowLeft } from 'lucide-react'
import { STATUS_LABELS, STATUS_COLORS, PAYMENT_DISCLAIMER } from '@/lib/constants'
import Link from 'next/link'
import CancelButton from './CancelButton'
import RescheduleButton from './RescheduleButton'
import { AddToCalendar } from '@/components/booking/AddToCalendar'

export default async function ConfirmationPage({
  params,
  searchParams,
}: {
  params: { confirmationNumber: string }
  searchParams: { token?: string }
}) {
  let appointment: any = null
  let hasToken = false

  try {
    // Require a valid customer access token to view appointment details.
    // The confirmation number alone is NOT sufficient authentication.
    if (searchParams.token && searchParams.token.length >= 32) {
      appointment = await prisma.appointment.findFirst({
        where: {
          confirmationNumber: params.confirmationNumber,
          customerAccessToken: searchParams.token,
        },
        include: {
          barber: true,
          service: true,
          business: true,
        },
      })
      hasToken = true
    } else {
      // Try to find by confirmation number only — show limited info
      appointment = await prisma.appointment.findUnique({
        where: { confirmationNumber: params.confirmationNumber },
        include: {
          barber: true,
          service: true,
          business: true,
        },
      })
    }
  } catch (error) {
    console.error('Failed to load appointment:', error)
  }

  if (!appointment) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Appointment Not Found</h1>
          <p className="text-gray-400 mb-6">
            We couldn't find an appointment with confirmation number{' '}
            <span className="font-mono text-amber-500">{params.confirmationNumber}</span>.
          </p>
          <Link href="/">
            <Button className="bg-amber-500 text-black hover:bg-amber-400">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  const isCancelled = appointment.status === 'CANCELLED'

  // If no token, show limited info and prompt for lookup
  if (!hasToken) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="text-center max-w-md space-y-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400 border border-amber-500/20 mx-auto">
            <Calendar className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold">Appointment Found</h1>
          <p className="text-gray-400 text-sm">
            We found your appointment. For security, please use the link from your confirmation email to view full details and manage your appointment.
          </p>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-4 text-left space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Confirmation</span>
              <span className="font-mono text-amber-500">{appointment.confirmationNumber}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Service</span>
              <span className="font-semibold">{appointment.service?.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Barber</span>
              <span className="font-semibold">{appointment.barber?.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Date</span>
              <span className="font-semibold">{formatFullDate(appointment.startTime)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Time</span>
              <span className="font-semibold">{formatTime(appointment.startTime)}</span>
            </div>
          </div>
          <Link href="/">
            <Button variant="outline" className="border-amber-500/30 text-amber-100 hover:bg-amber-500/10 hover:border-amber-500/50">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Home
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-2xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        {/* Success header */}
        <div className="text-center mb-8">
          {isCancelled ? (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-900/50 mb-4">
              <Calendar className="h-8 w-8 text-red-400" />
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-900/50 mb-4">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
          )}
          <h1 className="font-display text-3xl font-bold sm:text-4xl">
            {isCancelled ? 'Appointment Cancelled' : 'Appointment Confirmed!'}
          </h1>
          <p className="mt-2 text-gray-400">
            {isCancelled
              ? 'Your appointment has been cancelled.'
              : 'Your appointment has been successfully booked.'}
          </p>
        </div>

        {/* Confirmation number */}
        <div className="mb-6 text-center">
          <p className="text-sm text-gray-500 mb-1">Confirmation Number</p>
          <p className="font-mono text-2xl font-bold text-amber-500 tracking-wider">
            {appointment.confirmationNumber}
          </p>
        </div>

        {/* Details card — MINIMIZED data (no phone, email, notes shown publicly) */}
        <Card className="bg-zinc-900 border-zinc-800 mb-6">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Scissors className="h-5 w-5 text-amber-500" />
              Appointment Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Service */}
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-3">
                <Scissors className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-400">Service</span>
              </div>
              <div className="text-right">
                <p className="font-semibold">{appointment.service.name}</p>
                <p className="text-xs text-gray-500">
                  {formatDuration(appointment.service.duration)} · {formatPrice(appointment.service.price)}
                </p>
              </div>
            </div>

            {/* Barber */}
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-400">Barber</span>
              </div>
              <p className="font-semibold">{appointment.barber.name}</p>
            </div>

            {/* Date */}
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-400">Date</span>
              </div>
              <p className="font-semibold">{formatFullDate(appointment.startTime)}</p>
            </div>

            {/* Time */}
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-gray-500" />
                <span className="text-sm text-gray-400">Time</span>
              </div>
              <p className="font-semibold">{formatTime(appointment.startTime)}</p>
            </div>

            {/* Location */}
            {appointment.business?.address && (
              <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">Location</span>
                </div>
                <p className="max-w-[min(65%,18rem)] text-right font-semibold text-sm">
                  {appointment.business.address}
                </p>
              </div>
            )}

            {/* Status */}
            <div className="flex items-start justify-between">
              <span className="text-sm text-gray-400">Status</span>
              <Badge className={`${STATUS_COLORS[appointment.status] || ''} border`}>
                {STATUS_LABELS[appointment.status] || appointment.status}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Payment notice */}
        <div className="mb-6 rounded-lg bg-amber-950/30 border border-amber-900/50 p-4 text-center">
          <p className="text-sm font-semibold text-amber-500">Payment</p>
          <p className="text-sm text-gray-400 mt-1">
            Pay in person at the barbershop at the time of your appointment.
          </p>
          <p className="text-xs text-gray-600 mt-2">{PAYMENT_DISCLAIMER}</p>
        </div>

        {/* Shop contact for convenience */}
        {appointment.business && (
          <div className="mb-6 text-center text-sm text-gray-500">
            Need to make changes? Call{' '}
            <a href={`tel:${appointment.business.phone?.replace(/\D/g, '')}`} className="text-amber-500 hover:underline">
              {appointment.business.phone}
            </a>
          </div>
        )}

        {/* Add to Calendar */}
        {!isCancelled && (
          <div className="mb-6">
            <p className="text-center text-sm text-gray-500 mb-3">Add to your calendar:</p>
            <AddToCalendar
              serviceName={appointment.service.name}
              barberName={appointment.barber.name}
              startTime={appointment.startTime.toISOString()}
              endTime={appointment.endTime.toISOString()}
              businessName={appointment.business?.name}
              businessAddress={appointment.business?.address || undefined}
              businessPhone={appointment.business?.phone || undefined}
              businessTimezone={appointment.business?.timezone || 'UTC'}
            />
          </div>
        )}

        {/* Actions */}
        {!isCancelled && (
          <div className="flex flex-col items-stretch justify-center gap-3 sm:flex-row">
            <RescheduleButton
              token={searchParams.token!}
              serviceId={appointment.serviceId}
              barberId={appointment.barberId}
              currentStartTime={appointment.startTime.toISOString()}
            />
            <CancelButton
              confirmationNumber={appointment.confirmationNumber}
              token={searchParams.token!}
            />
          </div>
        )}

        {/* Back to home */}
        <div className="mt-8 text-center">
          <Link href="/" className="text-sm text-gray-500 hover:text-amber-500 transition-colors">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}
