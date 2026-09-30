import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

// ============================================================================
// Middleware
// 1. Security headers on ALL responses
// 2. Auth for /dashboard and /api/dashboard is handled at the route/page level
//    via getServerSession(authOptions) — NextAuth JWT validation.
// ============================================================================

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self' https://www.google.com; frame-ancestors 'none';",
}

function addSecurityHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Defense-in-depth: EVERY /api/dashboard route is business-staff-only.
  // Middleware rejects CUSTOMER sessions before any route code runs, so the
  // entire dashboard API surface is uniformly protected (page-level gate in
  // src/lib/onboarding.ts + per-route DB-fresh session checks remain the
  // authoritative guards — this layer catches gaps between them).
  if (pathname === '/login') {
    return addSecurityHeaders(NextResponse.json({ error: 'blocked' }, { status: 451 }))
  }
  if (pathname.startsWith('/api/dashboard')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    if (token.role === 'CUSTOMER') {
      return addSecurityHeaders(NextResponse.json({ error: 'Staff access required' }, { status: 403 }))
    }
  }

  // Stamp the request path so server components (e.g. the dashboard access
  // gate in src/lib/onboarding.ts) know which route is being rendered and
  // can exempt the gate's own redirect targets.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  addSecurityHeaders(response)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)',
  ],
}
