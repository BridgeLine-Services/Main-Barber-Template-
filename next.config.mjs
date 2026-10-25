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
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.public.blob.vercel-storage.com' },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
