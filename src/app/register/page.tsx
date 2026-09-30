import type { Metadata } from 'next'
import { resolveBusiness } from '@/lib/tenant'
import { ThemeStyle } from '@/components/customer/ThemeStyle'
import { RegisterForm } from './RegisterForm'

export const metadata: Metadata = {
  title: 'Create your account',
  robots: { index: false, follow: false },
}

// Same tenant-aware theme injection as /login: the signup page resolves the
// configured business and injects its ThemeStyle, so customer signup and
// owner login render as two states of one themed authentication experience.
export default async function RegisterPage() {
  const business = await resolveBusiness().catch(() => null)

  return (
    <>
      {business && <ThemeStyle business={business} />}
      <RegisterForm businessName={business?.name ?? null} />
    </>
  )
}
