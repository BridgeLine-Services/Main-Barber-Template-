import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canManageBusiness } from '@/lib/permissions'
import MediaPage from '../../media/page'

export const dynamic = 'force-dynamic'

export default async function LogoPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  if (!canManageBusiness((session.user as { role?: string }).role)) redirect('/dashboard')

  return (
    <MediaPage
      initialType="LOGO"
      title="Logo"
      description="Your shop logo, shown in the customer navbar, receipts and booking flow."
    />
  )
}
