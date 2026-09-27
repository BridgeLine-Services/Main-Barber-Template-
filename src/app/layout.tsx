import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Providers } from '@/components/providers'
import { PWARegister } from '@/components/pwa/PWARegister'
import { getAppUrl, getAppUrlString } from '@/lib/app-url'

// Template font options — every family selectable in onboarding/branding is
// loaded here so the owner's choice renders on the public site (see lib/theme.ts).
//
// SELF-HOSTED (§59): all fonts are vendored in src/fonts/ and loaded via
// next/font/local. The production build makes zero network requests to Google
// Fonts, so CI and Vercel builds are deterministic and cannot fail on an
// unreliable external fetch. To change the supported font set, add the woff2
// files to src/fonts/ and update FONT_FAMILY_OPTIONS in lib/theme.ts.
const inter = localFont({
  src: '../fonts/inter-latin-wght.woff2',
  weight: '100 900',
  variable: '--font-inter',
})
const poppins = localFont({
  src: [
    { path: '../fonts/poppins-latin-400.woff2', weight: '400' },
    { path: '../fonts/poppins-latin-500.woff2', weight: '500' },
    { path: '../fonts/poppins-latin-600.woff2', weight: '600' },
    { path: '../fonts/poppins-latin-700.woff2', weight: '700' },
  ],
  variable: '--font-poppins',
})
const montserrat = localFont({
  src: '../fonts/montserrat-latin-wght.woff2',
  weight: '100 900',
  variable: '--font-montserrat',
})
const playfair = localFont({ src: '../fonts/playfair-latin-wght.woff2', weight: '400 900', variable: '--font-playfair' })
const roboto = localFont({
  src: [
    { path: '../fonts/roboto-latin-400.woff2', weight: '400' },
    { path: '../fonts/roboto-latin-500.woff2', weight: '500' },
    { path: '../fonts/roboto-latin-700.woff2', weight: '700' },
  ],
  variable: '--font-roboto',
})
const oswald = localFont({
  src: '../fonts/oswald-latin-wght.woff2',
  weight: '200 700',
  variable: '--font-oswald',
})
const lato = localFont({
  src: [
    { path: '../fonts/lato-latin-400.woff2', weight: '400' },
    { path: '../fonts/lato-latin-700.woff2', weight: '700' },
  ],
  variable: '--font-lato',
})

export const metadata: Metadata = {
  metadataBase: getAppUrl(),
  title: {
    default: 'Barber Shop | Book Your Appointment',
    template: '%s',
  },
  description: 'Book your next haircut or beard trim. Pay in person — no app download required.',
  keywords: ['barber shop', 'haircut', 'beard trim', 'fades', 'barber near me', 'book appointment'],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: getAppUrlString(),
    title: 'Barber Shop | Book Your Appointment',
    description: 'Book your next haircut or beard trim. Pay in person — no app download required.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${poppins.variable} ${montserrat.variable} ${playfair.variable} ${roboto.variable} ${oswald.variable} ${lato.variable} font-sans`}>
        <PWARegister />
        <Providers>{children}</Providers>
    </body>
</html>
  )
}
