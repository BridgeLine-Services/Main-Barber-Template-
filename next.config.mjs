// ============================================================================
// next.config.mjs — Production configuration.
// Required runtime configuration is validated by the auth and database layers.
// ============================================================================


/** @type {import('next').NextConfig} */
const configuredAuthUrl = process.env.NEXTAUTH_URL?.trim()
const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
const deploymentUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim()
const buildAuthUrl = configuredAuthUrl || configuredAppUrl || (deploymentUrl ? `https://${deploymentUrl}` : 'https://example.com')

const nextConfig = {
  // NextAuth's client bundle parses NEXTAUTH_URL during static generation. A
  // blank Vercel variable otherwise becomes `new URL('')` and breaks every
  // page that includes the shared SessionProvider. Keep the runtime value
  // authoritative while supplying a valid build-time URL for previews.
  env: {
    NEXTAUTH_URL: buildAuthUrl,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          ...(process.env.NODE_ENV === 'production'
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000' }]
            : []),
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              "connect-src 'self' https:",
              "frame-src 'self' https://www.google.com",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
};

export default nextConfig;
