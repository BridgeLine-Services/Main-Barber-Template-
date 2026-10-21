// ============================================================================
// NextAuth Type Augmentation — adds custom fields to the Session user.
// ============================================================================

import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name: string
      role: 'PLATFORM_OWNER' | 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER' | 'CUSTOMER'
      businessId: string | null
    customerId: string | null
      businessName: string
      barberId: string | null
    }
  }

  interface User {
    id: string
    email: string
    name: string
    role: 'PLATFORM_OWNER' | 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER' | 'CUSTOMER'
    businessId: string | null
    businessName: string
    barberId: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'PLATFORM_OWNER' | 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER' | 'CUSTOMER'
    businessId?: string | null
    customerId?: string | null
    businessName?: string
    barberId?: string | null
    /** Sign-in stamp of the account's passwordChangedAt (epoch ms) — session-security */
    pwd?: number | null
    /** Set when a session was invalidated by a later password change */
    dead?: boolean
  }
}
