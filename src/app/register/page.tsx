import { redirect } from 'next/navigation'

// /login is the single public Login / Sign-Up entry point. All signup
// happens on /login and the server assigns the role: CUSTOMER for customer
// sign-up, OWNER for the self-service first-owner bootstrap (only while
// owner registration is open), and the invited role for invitation
// sign-ups.
export default function RegisterPage() {
  redirect('/login')
}
