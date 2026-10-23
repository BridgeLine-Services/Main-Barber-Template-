import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canManageBusiness } from '@/lib/permissions'
import MediaPage from '../../media/page'

export const dynamic = 'force-dynamic'

export default async function ShopPhotosPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')
  if (!canManageBusiness((session.user as { role?: string }).role)) redirect('/dashboard')

  return (
    <MediaPage
      initialType="SHOP_PHOTO"
      title="Shop Photos"
      description="Interior and exterior shots of your shop used across the public site."
    />
  )
}
