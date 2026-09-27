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
      role: 'PLATFORM_OWNER' | 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER'
      businessId: string | null
      businessName: string
      barberId: string | null
    }
  }

  interface User {
    id: string
    email: string
    name: string
    role: 'PLATFORM_OWNER' | 'OWNER' | 'BUSINESS_ADMIN' | 'BARBER'
    businessId: string | null
    businessName: string
    barberId: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: 'PLATFORM_OWNER' | 'OWNER' | 'BARBER'
    businessId?: string | null
    businessName?: string
    barberId?: string | null
  }
}
