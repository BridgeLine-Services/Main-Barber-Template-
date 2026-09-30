import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// ============================================================================
// UNIFIED POST-LOGIN ROUTER — the single post-authentication entry for every
// account type. One login at /login; the SERVER decides where the session
// belongs based on the authenticated user's role (never a client-supplied
// value).
//   CUSTOMER       → /portal
//   PLATFORM_OWNER  → /platform
//   OWNER / BUSINESS_ADMIN / BARBER → /dashboard
//     (the dashboard access gate then handles onboarding and password-change
//      redirects server-side)
// ============================================================================

export default async function AuthRedirectPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const role = (session.user as { role?: string }).role

  if (role === 'CUSTOMER') redirect('/portal')
  if (role === 'PLATFORM_OWNER') redirect('/platform')
  redirect('/dashboard')
}
