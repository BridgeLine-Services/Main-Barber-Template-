// Login page — server component. The single public Login / Sign-Up entry
// point for everyone. Owner registration is controlled by the deployment mode:
// `onboarding` enables the first-owner flow, `invite_only` hides public sign-up,
// and `disabled` prevents new registrations.

import { resolveBusiness } from '@/lib/tenant'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { prisma } from '@/lib/prisma'
import {
  isCustomerRegistrationOpen,
  isOwnerRegistrationOpen,
  parseOwnerRegistrationMode,
} from '@/lib/owner-registration'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  const business = await resolveBusiness().catch(() => null)
  const ownerRegistrationMode = parseOwnerRegistrationMode(process.env.OWNER_REGISTRATION_MODE)
  const hasOwner = !!(await prisma.user.findFirst({ where: { role: 'OWNER' }, select: { id: true } }).catch(() => null))

  return (
    <>
      {business && (
        <ThemeStyle business={business} />
      )}
      <LoginForm
        businessName={business?.name ?? null}
        ownerRegistrationMode={ownerRegistrationMode}
        ownerRegistrationOpen={isOwnerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE, hasOwner)}
        customerRegistrationOpen={isCustomerRegistrationOpen(process.env.OWNER_REGISTRATION_MODE)}
      />
    </>
  )
}
