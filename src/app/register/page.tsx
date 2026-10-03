import { redirect } from 'next/navigation'

// /login is the single public Login / Sign-Up entry point. Ordinary signup
// happens on /login and the server assigns the role: CUSTOMER for public
// sign-up, the invited role for invitation sign-ups. There is no public
// owner registration — owner accounts are created only by the authorized
// provisioning process (token-gated /api/auth/register-owner).
export default function RegisterPage() {
  redirect('/login')
}
