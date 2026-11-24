import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ReferralManager } from '@/components/dashboard/ReferralManager'

export const dynamic = 'force-dynamic'

export default async function ReferralsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  const role = (session.user as { role?: string }).role
  if (!['OWNER', 'BUSINESS_ADMIN', 'BARBER'].includes(role ?? '')) redirect('/dashboard')
  return <ReferralManager canManage={role === 'OWNER'} />
}
