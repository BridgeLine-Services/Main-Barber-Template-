import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

// ============================================================================
// Middleware
// 1. Security headers on ALL responses
// 2. Defense-in-depth staff guard for every /api/dashboard route
//    (the authoritative gates live at the route/page level via
//    getServerSession(authOptions) + DB-fresh role checks — see
//    src/lib/onboarding.ts)
// ============================================================================

// The dashboard embeds the authenticated customer-site preview in an iframe.
// A global DENY / frame-ancestors 'none' makes the browser refuse to render
// that iframe (200 response, but an error page inside the frame), so the
// preview could never show the real site. The preview route is the ONE
// exception: same-origin framing only. Third-party sites still cannot frame
// the app, and the route keeps its own authentication (anonymous visitors
// are redirected to login by the page itself).
const PREVIEW_PATH = '/dashboard/website-preview'

const SECURITY_HEADERS: Record<string, string> = {
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Do not advertise preload/includeSubDomains until every custom tenant
  // hostname is confirmed HTTPS-only and ready for preload submission.
  'Strict-Transport-Security': 'max-age=63072000',
  // React dev mode JIT-compiles with eval(), so development needs
  // 'unsafe-eval' in script-src; production builds never do. Inline styles
  // remain required for the server-rendered theme and component styles.
  'Content-Security-Policy':
    `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.public.blob.vercel-storage.com; font-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.google.com https://maps.google.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self';`,
}

function addSecurityHeaders(response: NextResponse, pathname?: string) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  if (pathname === PREVIEW_PATH) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN')
    response.headers.set(
      'Content-Security-Policy',
      SECURITY_HEADERS['Content-Security-Policy'].replace(
        "frame-ancestors 'none'",
        "frame-ancestors 'self'",
      ),
    )
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Defense-in-depth: EVERY /api/dashboard route is business-staff-only.
  // Middleware rejects CUSTOMER sessions before any route code runs, so the
  // entire dashboard API surface is uniformly protected (page-level gate in
  // src/lib/onboarding.ts + per-route DB-fresh session checks remain the
  // authoritative guards — this layer catches gaps between them).
  if (pathname.startsWith('/api/dashboard')) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    if (!token) {
      return addSecurityHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), pathname)
    }
    if (token.role === 'CUSTOMER') {
      return addSecurityHeaders(NextResponse.json({ error: 'Staff access required' }, { status: 403 }), pathname)
    }
  }

  // Stamp the request path so server components (e.g. the dashboard access
  // gate in src/lib/onboarding.ts) know which route is being rendered and
  // can exempt the gate's own redirect targets.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-pathname', pathname)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  addSecurityHeaders(response, pathname)
  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest).*)',
  ],
}
