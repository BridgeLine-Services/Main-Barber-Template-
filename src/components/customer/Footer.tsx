import Link from 'next/link'
import { Scissors, MapPin, Phone, Mail, Instagram, Facebook, Video, Youtube, Twitter, Lock } from 'lucide-react'

interface FooterProps {
  business?: {
    name?: string
    phone?: string | null
    email?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    zipCode?: string | null
    instagram?: string | null
    facebook?: string | null
    tiktok?: string | null
    youtube?: string | null
    xTwitter?: string | null
    twitter?: string | null
    hours?: any
    aboutText?: string | null
    bookingPolicy?: string | null
    privacyPolicy?: string | null
    termsPolicy?: string | null
  } | null
}

export function Footer({ business }: FooterProps) {
  const shopName = business?.name || 'Barber Shop'
  const fullAddress = [business?.address, business?.city, business?.state, business?.zipCode]
    .filter(Boolean)
    .join(', ')

  return (
    <footer className="border-t border-border/80 bg-background text-muted-foreground text-sm">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/30">
                <Scissors className="h-4 w-4" />
              </div>
              <span className="font-display text-lg font-semibold tracking-tight text-foreground">{shopName}</span>
            </div>
            {business?.aboutText && (
              <p className="text-muted-foreground text-sm leading-relaxed">
                {business.aboutText}
              </p>
            )}
            {/* Social Links */}
            <div className="flex items-center gap-3 pt-2">
              {business?.instagram && (
                <a
                  href={business.instagram.startsWith('http') ? business.instagram : `https://instagram.com/${business.instagram.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md bg-card text-muted-foreground hover:text-accent hover:bg-secondary transition"
                  aria-label="Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </a>
              )}
              {business?.facebook && (
                <a
                  href={business.facebook.startsWith('http') ? business.facebook : `https://facebook.com/${business.facebook}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md bg-card text-muted-foreground hover:text-accent hover:bg-secondary transition"
                  aria-label="Facebook"
                >
                  <Facebook className="h-4 w-4" />
                </a>
              )}
              {business?.tiktok && (
                <a
                  href={business.tiktok.startsWith('http') ? business.tiktok : `https://tiktok.com/@${business.tiktok.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md bg-card text-muted-foreground hover:text-accent hover:bg-secondary transition"
                  aria-label="TikTok"
                >
                  <Video className="h-4 w-4" />
                </a>
              )}
              {business?.youtube && (
                <a
                  href={business.youtube.startsWith('http') ? business.youtube : `https://youtube.com/@${business.youtube.replace('@', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md bg-card text-muted-foreground hover:text-accent hover:bg-secondary transition"
                  aria-label="YouTube"
                >
                  <Youtube className="h-4 w-4" />
                </a>
              )}
              {(() => {
                const twitter = business?.xTwitter || business?.twitter
                if (!twitter) return null
                const twitterHref = twitter.startsWith('http') ? twitter : `https://x.com/${twitter.replace('@', '')}`
                return (
                <a
                  href={twitterHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 rounded-md bg-card text-muted-foreground hover:text-accent hover:bg-secondary transition"
                  aria-label="X (Twitter)"
                >
                  <Twitter className="h-4 w-4" />
                </a>
                )
              })()}
            </div>
          </div>

          {/* Contact Details */}
          <div className="space-y-3">
            <h3 className="text-foreground font-semibold text-base">Contact & Location</h3>
            <ul className="space-y-2.5">
              {fullAddress && (
                <li className="flex items-start gap-2.5">
                  <MapPin className="h-4 w-4 text-accent mt-0.5 shrink-0" />
                  <span>{fullAddress}</span>
                </li>
              )}
              {business?.phone && (
                <li className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 text-accent shrink-0" />
                  <a href={`tel:${business.phone.replace(/\D/g, '')}`} className="hover:text-accent transition">
                    {business.phone}
                  </a>
                </li>
              )}
              {business?.email && (
                <li className="flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-accent shrink-0" />
                  <a href={`mailto:${business.email}`} className="hover:text-accent transition">
                    {business.email}
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* Quick Links */}
          <div className="space-y-3">
            <h3 className="text-foreground font-semibold text-base">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link href="/" className="hover:text-accent transition">Home</Link>
              </li>
              <li>
                <Link href="/services" className="hover:text-accent transition">Services & Pricing</Link>
              </li>
              <li>
                <Link href="/barbers" className="hover:text-accent transition">Meet Our Barbers</Link>
              </li>
              <li>
                <Link href="/gallery" className="hover:text-accent transition">Gallery</Link>
              </li>
              <li>
                <Link href="/book" className="text-accent hover:underline font-medium">Book Appointment</Link>
              </li>
              <li>
                <Link href="/reviews" className="hover:text-accent transition">Client Reviews</Link>
              </li>
            </ul>
          </div>

          {/* Policy & Hours */}
          <div className="space-y-3">
            <h3 className="text-foreground font-semibold text-base">Shop Policies & Legal</h3>
            <ul className="space-y-2">
              {business?.bookingPolicy && (
                <li>
                  <Link href="/booking-policy" className="hover:text-accent transition">Booking & Cancellation Policy</Link>
                </li>
              )}
              {business?.privacyPolicy && (
                <li>
                  <Link href="/privacy" className="hover:text-accent transition">Privacy Policy</Link>
                </li>
              )}
              {business?.termsPolicy && (
                <li>
                  <Link href="/terms" className="hover:text-accent transition">Terms of Service</Link>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-border/60 flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-4">
          <p>© {new Date().getFullYear()} {shopName?.replace(/\.$/, '')}. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="flex items-center gap-1.5 text-muted-foreground/70 hover:text-accent transition"
              aria-label="Staff Login"
            >
              <Lock className="h-3 w-3" />
              <span>Staff Login</span>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
