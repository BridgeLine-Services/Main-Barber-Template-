// Login page — server component.
//
// Reads OWNER_REGISTRATION_MODE on the server so the registration UI adapts
// to the deployment without any client-side env access, and the API enforces
// the same mode independently of what this page renders.
//
// The page also resolves the tenant business (when one is configured) to
// inject the shop's theme (ThemeStyle) and pass its name to the form — so
// authentication is a continuation of the public brand, not a separate
// generic screen. Falls back to the template's default tokens when no
// business is set up yet.

import { getOwnerRegistrationMode } from '@/lib/app-config'
import { resolveBusiness } from '@/lib/tenant'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  const registrationMode = getOwnerRegistrationMode()
  const business = await resolveBusiness().catch(() => null)

  return (
    <>
      {business && (
        <ThemeStyle
          business={business}
        />
      )}
      <LoginForm
        registrationMode={registrationMode}
        businessName={business?.name ?? null}
      />
    </>
  )
}
