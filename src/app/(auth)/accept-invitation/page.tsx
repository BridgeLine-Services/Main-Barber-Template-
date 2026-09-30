import type { Metadata } from 'next'
import { AcceptInvitationForm } from './AcceptInvitationForm'

export const metadata: Metadata = {
  title: 'Accept your invitation',
  robots: { index: false, follow: false },
}

export default function AcceptInvitationPage() {
  return <AcceptInvitationForm />
}
