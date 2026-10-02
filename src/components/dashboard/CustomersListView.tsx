'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CustomerSearch } from '@/components/dashboard/CustomerSearch'
import { Users, Phone, Mail, Calendar, ChevronRight } from 'lucide-react'

interface CustomersListViewProps {
  initialCustomers: Array<{
    id: string
    firstName?: string | null
    lastName?: string | null
    email?: string | null
    phone?: string | null
    appointments?: Array<{ startTime: string }>
    _count?: { appointments: number }
  }>
}

export function CustomersListView({ initialCustomers }: CustomersListViewProps) {
  const [query, setQuery] = useState('')

  const filtered = initialCustomers.filter((c) => {
    if (!query) return true
    const q = query.toLowerCase()
    const name = `${c.firstName} ${c.lastName}`.toLowerCase()
    const phone = c.phone || ''
    const email = (c.email || '').toLowerCase()
    return name.includes(q) || phone.includes(q) || email.includes(q)
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-serif text-foreground flex items-center gap-2">
            <Users className="w-6 h-6 text-amber-500" />
            <span>Customer Directory</span>
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Total {initialCustomers.length} registered clients
          </p>
        </div>

        <CustomerSearch onSearch={setQuery} />
      </div>

      <div className="bg-[var(--dash-surface)] border border-border rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-foreground/85">
            <thead className="bg-card/80 uppercase font-semibold text-muted-foreground border-b border-border">
              <tr>
                <th className="p-3.5 pl-4">Customer Name</th>
                <th className="p-3.5">Phone</th>
                <th className="p-3.5">Email</th>
                <th className="p-3.5">Total Visits</th>
                <th className="p-3.5">Last Visit</th>
                <th className="p-3.5 pr-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No customers found matching "{query}".
                  </td>
                </tr>
              ) : (
                filtered.map((c) => {
                  const totalAppts = c._count?.appointments || c.appointments?.length || 0
                  const lastAppt = c.appointments && c.appointments[0] ? new Date(c.appointments[0].startTime) : null

                  return (
                    <tr
                      key={c.id}
                      className="hover:bg-card/70 transition-colors group"
                    >
                      <td className="p-3.5 pl-4 font-semibold text-foreground group-hover:text-amber-400 transition-colors">
                        <Link href={`/dashboard/customers/${c.id}`} className="block">
                          {c.firstName} {c.lastName}
                        </Link>
                      </td>
                      <td className="p-3.5 text-foreground/85 font-mono">
                        <a href={`tel:${c.phone?.replace(/\D/g, "")}`} className="hover:text-amber-400 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-muted-foreground" />
                          {c.phone}
                        </a>
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        <a href={`mailto:${c.email}`} className="hover:text-amber-400 flex items-center gap-1">
                          <Mail className="w-3 h-3 text-muted-foreground" />
                          {c.email}
                        </a>
                      </td>
                      <td className="p-3.5 font-bold text-amber-400 font-mono">
                        {totalAppts}
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {lastAppt ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-muted-foreground" />
                            {lastAppt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        ) : (
                          'No visits recorded'
                        )}
                      </td>
                      <td className="p-3.5 pr-4 text-right">
                        <Link
                          href={`/dashboard/customers/${c.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300"
                        >
                          View Profile <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
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
