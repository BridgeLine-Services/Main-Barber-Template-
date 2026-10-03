// Login page — server component. The single public Login / Sign-Up entry
// point for everyone: customers, invited staff, and provisioned owners all
// sign in here. Public Sign-Up always creates a CUSTOMER account
// (server-assigned); staff roles come only from the invitation lifecycle;
// owner accounts only through the authorized provisioning process.
//
// The page resolves the tenant business (when one is configured) to inject
// the shop's theme (ThemeStyle) and pass its name to the form — so
// authentication is a continuation of the public brand, not a separate
// generic screen. Falls back to the template's default tokens when no
// business is set up yet.

import { resolveBusiness } from '@/lib/tenant'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import LoginForm from './LoginForm'

export default async function LoginPage() {
  const business = await resolveBusiness().catch(() => null)

  return (
    <>
      {business && (
        <ThemeStyle
          business={business}
        />
      )}
      <LoginForm businessName={business?.name ?? null} />
    </>
  )
}
