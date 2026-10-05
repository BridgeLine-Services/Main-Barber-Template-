import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { canManagePayroll, getPayrollSettings } from '@/lib/payroll'
import { PayrollClient } from './PayrollClient'

/**
 * Owner-only Payroll Reporting dashboard: generate payroll-ready period
 * reports (time clock hours + completed services + payments + tips +
 * commissions + adjustments), review them, export CSV, finalize, and
 * manage the shop-level feature settings. Barbers and admins are
 * redirected — owner APIs enforce the same server-side.
 *
 * This page is a payroll REPORTING tool only: it never issues payments
 * and never becomes a payroll processor.
 */
export default async function PayrollPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const user = session.user
  if (!canManagePayroll(user.role) || !user.businessId) redirect('/dashboard')

  const settings = await getPayrollSettings(user.businessId)

  return <PayrollClient enabled={settings.enabled} />
}
