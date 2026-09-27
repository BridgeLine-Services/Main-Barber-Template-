// Platform administration console — PLATFORM_OWNER only.
// Server-side gate: the session role is re-resolved from the database on
// every render. Business owners, barbers, customers, and anonymous
// visitors are redirected to login. Direct URL access cannot bypass this.

import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { deactivateBusiness, reactivateBusiness } from './actions'
import { CreateBusinessForm } from './CreateBusinessForm'

export const dynamic = 'force-dynamic'

export default async function PlatformPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user) redirect('/login')

  const su = session.user as { id?: string; email?: string }
  const dbUser = await prisma.user.findUnique({
    where: su.id ? { id: su.id } : su.email ? { email: su.email } : undefined,
    select: { role: true },
  })
  if (!dbUser || dbUser.role !== 'PLATFORM_OWNER') redirect('/login')

  const businesses = await prisma.business.findMany({
    select: {
      id: true, name: true, slug: true, deactivatedAt: true, onboardingCompleted: true,
      createdAt: true,
      _count: { select: { users: true, appointments: true } },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Platform Console</h1>
            <p className="text-sm text-gray-500">Manage barber businesses on this platform.</p>
          </div>
          <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700">
            Platform Owner
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <section aria-labelledby="business-list-heading">
          <h2 id="business-list-heading" className="mb-3 text-lg font-semibold">
            Businesses ({businesses.length})
          </h2>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Business</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Staff</th>
                  <th scope="col" className="px-4 py-3">Appointments</th>
                  <th scope="col" className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{b.name}</div>
                      <div className="text-xs text-gray-500">/{b.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      {b.deactivatedAt ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Deactivated</span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Active</span>
                      )}
                      {!b.onboardingCompleted && !b.deactivatedAt && (
                        <div className="text-xs text-gray-400">Onboarding in progress</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{b._count.users}</td>
                    <td className="px-4 py-3">{b._count.appointments}</td>
                    <td className="px-4 py-3">
                      {b.deactivatedAt ? (
                        <form action={reactivateBusiness.bind(null, b.id)}>
                          <button
                            type="submit"
                            className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-gray-50"
                          >
                            Reactivate
                          </button>
                        </form>
                      ) : (
                        <form action={deactivateBusiness.bind(null, b.id)}>
                          <button
                            type="submit"
                            className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                          >
                            Deactivate
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="create-business-heading">
          <h2 id="create-business-heading" className="mb-3 text-lg font-semibold">
            Create a business
          </h2>
          <CreateBusinessForm />
        </section>
      </main>
    </div>
  )
}
