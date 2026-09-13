import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCustomerIntelligence } from '@/lib/customer-intelligence'
import { formatPreferencesForDisplay, computePreferredBarber } from '@/lib/customer-history'
import { STATUS_LABELS, STATUS_COLORS } from '@/lib/constants'
import { formatFullDate, formatTime, formatPrice } from '@/lib/utils'
import {
  ArrowLeft,
  Phone,
  Mail,
  FileText,
  CheckCircle2,
  XCircle,
  Calendar,
  Clock,
  Scissors,
  DollarSign,
  User,
  AlertTriangle,
  TrendingDown,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { CustomerProfileClient } from './CustomerProfileClient'

interface CustomerDetailPageProps {
  params: {
    id: string
  }
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    redirect('/login')
  }

  const user = session.user as any
  const businessId = user.businessId

  let customer: any = null
  try {
    customer = await prisma.customer.findFirst({
      where: {
        id: params.id,
        businessId,
      },
      include: {
        appointments: {
          include: {
            service: true,
            barber: true,
          },
          orderBy: {
            startTime: 'desc',
          },
        },
      },
    })
  } catch (error) {
    console.error('Failed to load customer:', error)
  }

  if (!customer) {
    notFound()
  }

  // Compute customer intelligence
  const intelligence = await getCustomerIntelligence(params.id, businessId)

  const appointments = customer.appointments
  const totalAppointments = appointments.length

  const completedAppointments = appointments.filter((a: any) => a.status === 'COMPLETED')
  const totalSpent = completedAppointments.reduce((acc: number, a: any) => acc + (a.service?.price || 0), 0)

  const lastVisit = intelligence.lastVisit
  const firstVisit = intelligence.firstVisit

  // Format predicted date
  const predictedDateStr = intelligence.nextPredictedDate
    ? intelligence.nextPredictedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Back button */}
      <div>
        <Link
          href="/dashboard/customers"
          className="inline-flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-amber-400 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Customers
        </Link>
      </div>

      {/* Profile Header & Info */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-xl font-serif">
              {customer.firstName[0]}
              {customer.lastName[0]}
            </div>
            <div>
              <h1 className="text-2xl font-bold font-serif text-zinc-100">
                {customer.firstName} {customer.lastName}
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Customer since {new Date(customer.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </p>
              {intelligence.isDueForRebook && (
                <span className="inline-flex items-center gap-1.5 mt-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" /> Due for rebooking
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 font-medium">SMS Notifications:</span>
            {customer.smsConsent ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Consented
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-zinc-500 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full font-medium">
                <XCircle className="w-3.5 h-3.5" /> Opted Out
              </span>
            )}
          </div>
        </div>

        {/* Contact Info & Notes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-3 bg-zinc-900/60 border border-zinc-800/60 p-4 rounded-xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" /> Phone Number
            </span>
            <p className="text-sm font-mono text-zinc-200">
              <a href={`tel:${customer.phone?.replace(/\D/g, "")}`} className="hover:text-amber-400 transition-colors">
                {customer.phone}
              </a>
            </p>
          </div>

          <div className="space-y-3 bg-zinc-900/60 border border-zinc-800/60 p-4 rounded-xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" /> Email Address
            </span>
            <p className="text-sm text-zinc-200 truncate">
              <a href={`mailto:${customer.email}`} className="hover:text-amber-400 transition-colors">
                {customer.email}
              </a>
            </p>
          </div>

          <div className="space-y-3 bg-zinc-900/60 border border-zinc-800/60 p-4 rounded-xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-500 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Customer Notes
              <span className="ml-1 text-[9px] font-medium text-zinc-500 bg-zinc-800 border border-zinc-700 rounded-full px-1.5 py-0.5">STAFF ONLY</span>
            </span>
            <p className="text-xs text-zinc-300 italic">
              {customer.notes ? customer.notes : 'No custom notes provided for this customer.'}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          <CustomerProfileClient customerId={customer.id} />
        </div>
      </div>

      {/* Customer Intelligence Section */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-bold font-serif text-zinc-100 flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-amber-500" />
          <span>Customer Intelligence</span>
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {/* Visits */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-amber-500" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Visits</span>
            </div>
            <p className="text-2xl font-bold font-mono text-zinc-100">{intelligence.visitCount}</p>
          </div>

          {/* Last Visit */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-blue-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Last Visit</span>
            </div>
            <p className="text-sm font-semibold text-zinc-200 mt-1">
              {lastVisit ? new Date(lastVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'N/A'}
            </p>
          </div>

          {/* Favorite Barber */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-purple-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Fav. Barber</span>
            </div>
            <p className="text-sm font-semibold text-zinc-200">{intelligence.favoriteBarber?.name || 'N/A'}</p>
          </div>

          {/* Favorite Service */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Scissors className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Fav. Service</span>
            </div>
            <p className="text-sm font-semibold text-zinc-200">{intelligence.favoriteService?.name || 'N/A'}</p>
          </div>

          {/* Average Ticket */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Avg Ticket</span>
            </div>
            <p className="text-2xl font-bold font-mono text-emerald-400">
              {intelligence.averageTicket !== null ? formatPrice(intelligence.averageTicket) : 'N/A'}
            </p>
          </div>

          {/* Average Interval */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-indigo-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Avg Interval</span>
            </div>
            <p className="text-2xl font-bold font-mono text-zinc-100">
              {intelligence.averageIntervalDays ? `${intelligence.averageIntervalDays}d` : 'N/A'}
            </p>
          </div>

          {/* Lifetime Value */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-emerald-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Lifetime Value</span>
            </div>
            <p className="text-2xl font-bold font-mono text-emerald-400">{formatPrice(intelligence.lifetimeValue)}</p>
          </div>

          {/* Cancellations */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <XCircle className="w-4 h-4 text-red-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Cancellations</span>
            </div>
            <p className="text-2xl font-bold font-mono text-zinc-100">{intelligence.cancellationCount}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {intelligence.lastCancellationDate
                ? `Last: ${new Date(intelligence.lastCancellationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                : 'Never'}
            </p>
          </div>

          {/* No-shows */}
          <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">No-shows</span>
            </div>
            <p className="text-2xl font-bold font-mono text-zinc-100">{intelligence.noShowCount}</p>
          </div>

          {/* Next Predicted */}
          <div className={`rounded-xl p-4 border ${intelligence.isDueForRebook ? 'bg-amber-500/10 border-amber-500/30' : 'bg-zinc-900/60 border-zinc-800/60'}`}>
            <div className="flex items-center gap-2 mb-2">
              <Calendar className={`w-4 h-4 ${intelligence.isDueForRebook ? 'text-amber-400' : 'text-zinc-400'}`} />
              <span className="text-[10px] uppercase tracking-wider text-zinc-500">Next Expected</span>
            </div>
            <p className={`text-sm font-semibold mt-1 ${intelligence.isDueForRebook ? 'text-amber-400' : 'text-zinc-200'}`}>
              {predictedDateStr || 'N/A'}
            </p>
            {intelligence.isDueForRebook && (
              <p className="text-[10px] text-amber-400/80 mt-1">Due for rebooking</p>
            )}
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-zinc-400 font-medium">Total Appointments</p>
            <p className="text-xl font-bold font-mono text-zinc-100">{totalAppointments}</p>
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-zinc-400 font-medium">Total Revenue</p>
            <p className="text-xl font-bold font-mono text-emerald-400">{formatPrice(totalSpent)}</p>
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-zinc-400 font-medium">First Visit</p>
            <p className="text-xs font-semibold text-zinc-200 mt-1">
              {firstVisit ? new Date(firstVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
            </p>
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
            <Calendar className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-zinc-400 font-medium">Last Visit</p>
            <p className="text-xs font-semibold text-zinc-200 mt-1">
              {lastVisit ? new Date(lastVisit).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Haircut History & Preferences */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Scissors className="w-5 h-5 text-amber-500" />
            <span>Haircut History &amp; Preferences</span>
          </h2>
          {customer.archivedAt && (
            <span className="text-[10px] font-medium text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-full px-2 py-0.5">
              ARCHIVED CUSTOMER
            </span>
          )}
        </div>

        {/* Preferred barber (derived from completed history) */}
        {(() => {
          const preferred = computePreferredBarber(appointments)
          return (
            <div className="flex items-center gap-3 text-sm bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
              <User className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-zinc-400 text-xs uppercase tracking-wide">Preferred Barber</span>
              <span className="text-zinc-100 font-medium">
                {preferred ? preferred.barberName : 'N/A'}
              </span>
              {preferred && (
                <span className="text-[10px] text-zinc-500">
                  {preferred.completedVisits} completed visit{preferred.completedVisits === 1 ? '' : 's'}
                </span>
              )}
              <span className="ml-auto text-[10px] text-zinc-600">derived from completed visits</span>
            </div>
          )
        })()}

        {/* Saved preferences (flexible JSON field on the Customer model) */}
        <div>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-500">Saved Preferences</span>
            <span className="text-[9px] font-medium text-zinc-500 bg-zinc-800 border border-zinc-700 rounded-full px-1.5 py-0.5">CUSTOMER VISIBLE</span>
          </div>
          {(() => {
            const prefs = formatPreferencesForDisplay(customer.preferences)
            return prefs.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">
                No saved preferences. Customers can add their own from the customer portal, or staff can record them here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {prefs.map(p => (
                  <span key={p.key} className="inline-flex items-baseline gap-1.5 text-xs bg-zinc-900/60 border border-zinc-800 rounded-full px-3 py-1.5">
                    <span className="text-zinc-500">{p.label}</span>
                    <span className="text-zinc-200 font-medium">{p.value}</span>
                  </span>
                ))}
              </div>
            )
          })()}
        </div>

        {/* Rebooking interval (if configured) */}
        {intelligence.averageIntervalDays && (
          <div className="flex items-center gap-3 text-sm bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4">
            <Clock className="w-4 h-4 text-blue-400 shrink-0" />
            <span className="text-zinc-400 text-xs uppercase tracking-wide">Typical Rebooking Interval</span>
            <span className="text-zinc-100 font-medium">{intelligence.averageIntervalDays} days</span>
            {predictedDateStr && (
              <span className="ml-auto text-[10px] text-zinc-600">predicted next visit ~ {predictedDateStr}</span>
            )}
          </div>
        )}
      </div>

      {/* Appointment History Table */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-bold font-serif text-zinc-100 flex items-center gap-2">
          <Scissors className="w-5 h-5 text-amber-500" />
          <span>Appointment History</span>
        </h2>

        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full text-left text-xs text-zinc-300">
            <thead className="bg-zinc-900/80 uppercase font-semibold text-zinc-400 border-b border-zinc-800">
              <tr>
                <th className="p-3.5 pl-4">Confirmation #</th>
                <th className="p-3.5">Date & Time</th>
                <th className="p-3.5">Service</th>
                <th className="p-3.5">Barber</th>
                <th className="p-3.5">Price</th>
                <th className="p-3.5 pr-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {appointments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-zinc-500">
                    No appointment history found for this customer.
                  </td>
                </tr>
              ) : (
                appointments.map((appt: any) => {
                  const dateStr = formatFullDate(new Date(appt.startTime))
                  const timeStr = `${formatTime(new Date(appt.startTime))} - ${formatTime(new Date(appt.endTime))}`
                  const statusColor = STATUS_COLORS[appt.status] || 'bg-zinc-800 text-zinc-300 border-zinc-700'
                  const statusLabel = STATUS_LABELS[appt.status] || appt.status

                  return (
                    <tr key={appt.id} className="hover:bg-zinc-900/70 transition-colors">
                      <td className="p-3.5 pl-4 font-mono text-amber-400 text-[11px]">
                        {appt.confirmationNumber}
                      </td>
                      <td className="p-3.5">
                        <div className="font-medium text-zinc-200">{dateStr}</div>
                        <div className="text-[10px] text-zinc-500">{timeStr}</div>
                      </td>
                      <td className="p-3.5">{appt.service?.name || 'N/A'}</td>
                      <td className="p-3.5">{appt.barber?.name || 'N/A'}</td>
                      <td className="p-3.5 font-mono text-zinc-200">{formatPrice(appt.service?.price || 0)}</td>
                      <td className="p-3.5 pr-4 text-right">
                        <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
