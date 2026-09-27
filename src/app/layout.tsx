import type { Metadata } from 'next'
import { Inter, Poppins, Montserrat, Playfair_Display, Roboto, Oswald, Lato } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { PWARegister } from '@/components/pwa/PWARegister'
import { getAppUrl, getAppUrlString } from '@/lib/app-url'

// Template font options — every family selectable in onboarding/branding is
// loaded here so the owner's choice renders on the public site (see lib/theme.ts).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-poppins' })
const montserrat = Montserrat({ subsets: ['latin'], variable: '--font-montserrat' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair' })
const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-roboto' })
const oswald = Oswald({ subsets: ['latin'], weight: ['400', '500', '700'], variable: '--font-oswald' })
const lato = Lato({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-lato' })

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
