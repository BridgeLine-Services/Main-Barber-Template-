export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCurrentBusinessId } from '@/lib/business'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'

/**
 * GET /api/dashboard/customers/export
 * Export all customers as CSV download (owner only)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if ((session.user as any).role !== 'OWNER') {
      return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
    }
    try {
      const businessId = await getCurrentBusinessId()
      const customers = await prisma.customer.findMany({
        where: { businessId },
        include: {
          appointments: {
            select: {
              id: true,
              status: true,
              startTime: true,
              service: { select: { name: true, price: true } },
            },
            orderBy: { startTime: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      })
      // Build CSV
      const headers = [
        'First Name',
        'Last Name',
        'Email',
        'Phone',
        'Total Appointments',
        'Completed Appointments',
        'Cancelled Appointments',
        'No-Show Appointments',
        'Last Visit',
        'Total Spent (estimated)',
        'Notes',
        'Created At',
      ]
      const rows = customers.map((c) => {
        const completed = c.appointments.filter(a => a.status === 'COMPLETED')
        const cancelled = c.appointments.filter(a => a.status === 'CANCELLED')
        const noShow = c.appointments.filter(a => a.status === 'NO_SHOW')
        const lastVisit = completed[0]?.startTime
        const totalSpent = completed
          .reduce((sum, a) => sum + (a.service?.price || 0), 0)
        return [
          c.firstName,
          c.lastName,
          c.email,
          c.phone,
          c.appointments.length,
          completed.length,
          cancelled.length,
          noShow.length,
          lastVisit ? new Date(lastVisit).toISOString().split('T')[0] : 'N/A',
          totalSpent.toFixed(2),
          (c.notes || '').replace(/"/g, '""'),
          new Date(c.createdAt).toISOString().split('T')[0],
        ]
      })
      // Escape CSV values
      const escapeCsv = (val: any) => {
        const str = String(val ?? '')
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }
      const csv = [
        headers.map(escapeCsv).join(','),
        ...rows.map(r => r.map(escapeCsv).join(',')),
      ].join('\n')
      const timestamp = new Date().toISOString().split('T')[0]
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="customers-export-${timestamp}.csv"`,
        },
      })
    } catch (error: any) {
      if (error.code === 'P1001' || error.message?.includes('No business found')) {
        return NextResponse.json({ error: 'Database connection error. Please try again.' }, { status: 503 })
      }
      console.error('Customer export error:', error)
      return NextResponse.json({ error: 'Failed to export customers' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/customers/export')
  }
}
