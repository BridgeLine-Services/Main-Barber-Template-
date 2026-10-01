import { redirect } from 'next/navigation'

// /login is the single public Login / Sign-Up entry point. Ordinary signup
// happens on /login and the server assigns the role: CUSTOMER for public
// sign-up, the invited role for invitation sign-ups, OWNER only through the
// controlled onboarding mode (OWNER_REGISTRATION_MODE=onboarding).
export default function RegisterPage() {
  redirect('/login')
}
