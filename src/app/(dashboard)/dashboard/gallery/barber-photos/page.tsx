import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canManageBusiness } from '@/lib/permissions'
import MediaPage from '../../media/page'

export const dynamic = 'force-dynamic'

export default async function BarberPhotosPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  if (!canManageBusiness((session.user as { role?: string }).role)) redirect('/dashboard')

  return (
    <MediaPage
      initialType="BARBER_PHOTO"
      title="Barber Photos"
      description="Portrait photos for each barber profile on the public team section."
    />
  )
}
