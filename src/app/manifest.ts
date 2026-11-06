import { MetadataRoute } from 'next'
import { resolvePublicBusiness } from '@/lib/tenant'
import { isFeatureEnabledForBusiness } from '@/lib/features'

export const dynamic = 'force-dynamic'

/**
 * Web app manifest, generated per resolved business so an installed PWA
 * shows the shop's own name and brand color. Falls back to generic
 * template values when no business is resolved (dev / platform deploy).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const business = await resolvePublicBusiness().catch(() => null)

  // Feature gate: with installability switched off the manifest still resolves (browsers
  // expect one) but carries no icons and display 'browser', which is what makes a site
  // installable. Nothing about the site itself breaks; it simply cannot be installed.
  const installable = business ? await isFeatureEnabledForBusiness(business.id, 'pwa') : true

  const name = business?.name || process.env.NEXT_PUBLIC_APP_NAME || 'Book Appointment'
  const themeColor = business?.primaryColor || '#1a1a1a'

  if (!installable) {
    return { name, short_name: name.split(' ')[0], display: 'browser' }
  }

  return {
    name,
    short_name: name.split(' ')[0],
    description:
      business
        ? `Book your appointment at ${business.name} online. Quick, easy, no app download required.`
        : 'Book your next appointment online. Quick, easy, no app download required.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: themeColor,
    categories: ['lifestyle', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
    // Accent color is not part of the standard manifest schema; expose it
    // through the splash-screen shortcut naming for clients that read it.
    shortcuts: [
      {
        name: 'Book an appointment',
        short_name: 'Book',
        url: '/book',
      },
    ],
  }
}
