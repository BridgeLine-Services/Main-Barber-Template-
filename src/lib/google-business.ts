// ============================================================================
// Google Business Profile Integration
// Syncs business info, hours, and reviews with Google Business Profile.
//
// OAuth flow:
//   1. User clicks "Connect" → redirected to Google consent screen
//   2. Google redirects to /api/dashboard/google-business/callback
//   3. Callback exchanges code for access + refresh tokens
//   4. Tokens stored as env vars (GBP_ACCESS_TOKEN, GBP_REFRESH_TOKEN)
//   5. Sync endpoint uses token to push/pull data via GBP API
//
// Required env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET — for OAuth
//   GBP_ACCESS_TOKEN — short-lived access token from OAuth
//   GBP_REFRESH_TOKEN — long-lived refresh token (optional but recommended)
//   GBP_ACCOUNT_ID — the Google account ID (e.g. "accounts/123456")
//   GBP_LOCATION_ID — the location ID (e.g. "accounts/123456/locations/789")
// ============================================================================

import { prisma } from '@/lib/prisma'
import { isGoogleEnabled } from '@/lib/env-check'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GBPConfig {
  connected: boolean
  accountId?: string
  locationId?: string
  lastSyncedAt?: string
}

export interface SyncResult {
  success: boolean
  syncedFields: string[]
  errors: string[]
}

// ─── Token Management ──────────────────────────────────────────────────────

/**
 * Get a valid access token, refreshing if needed.
 */
async function getAccessToken(): Promise<string | null> {
  const accessToken = process.env.GBP_ACCESS_TOKEN
  const refreshToken = process.env.GBP_REFRESH_TOKEN

  if (!accessToken && !refreshToken) return null

  // If we have an access token, try to use it (we can't easily check expiry
  // without making a request, so we'll let the API call fail and refresh)
  if (accessToken) return accessToken

  // Only have refresh token — exchange for a new access token
  if (refreshToken) {
    return refreshAccessToken(refreshToken)
  }

  return null
}

/**
 * Exchange a refresh token for a new access token.
 */
async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) return null

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    })

    const data = await response.json()
    if (!response.ok) {
      console.error('GBP token refresh error:', data)
      return null
    }

    // Note: In production, persist this new access token somewhere durable.
    // For now we return it for immediate use.
    return data.access_token
  } catch (error) {
    console.error('GBP token refresh failed:', error)
    return null
  }
}

// ─── GBP API Helpers ───────────────────────────────────────────────────────

/**
 * Get the full GBP location name path: "accounts/{accountId}/locations/{locationId}"
 */
function getLocationPath(): string | null {
  const accountId = process.env.GBP_ACCOUNT_ID
  const locationId = process.env.GBP_LOCATION_ID
  if (!accountId || !locationId) return null
  return `${accountId}/${locationId}`
}

// ─── Sync Functions ─────────────────────────────────────────────────────────

/**
 * Build the Google Business Profile hours JSON from the business's hours field.
 * GBP expects: { periods: [{ openDay, openTime, closeDay, closeTime }], isAlwaysOpen }
 */
function buildGBPHours(businessHours: any): any {
  if (!businessHours) return { periods: [], isAlwaysOpen: false }

  const dayMap: Record<string, string> = {
    monday: 'MONDAY', tuesday: 'TUESDAY', wednesday: 'WEDNESDAY',
    thursday: 'THURSDAY', friday: 'FRIDAY', saturday: 'SATURDAY', sunday: 'SUNDAY',
  }

  const periods: any[] = []
  for (const [day, hours] of Object.entries(businessHours)) {
    const dayName = dayMap[day.toLowerCase()]
    if (!dayName) continue
    const h = hours as any
    if (h.isOff) continue
    if (!h.open || !h.close) continue

    periods.push({
      openDay: dayName,
      openTime: { hours: parseInt(h.open.split(':')[0]), minutes: parseInt(h.open.split(':')[1] || '0') },
      closeDay: dayName,
      closeTime: { hours: parseInt(h.close.split(':')[0]), minutes: parseInt(h.close.split(':')[1] || '0') },
    })
  }

  return { periods, isAlwaysOpen: periods.length === 7 }
}

/**
 * Prepare the business data payload for GBP sync.
 * This is the data that gets pushed to Google Business Profile.
 */
export async function prepareBusinessSyncPayload(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  })

  if (!business) throw new Error('Business not found')

  return {
    title: business.name,
    websiteUrl: business.slug ? `https://${business.slug}.vercel.app` : null,
    primaryPhone: business.phone || null,
    primaryCategory: { displayName: 'Barber Shop' },
    address: {
      addressLines: [business.address].filter(Boolean),
      locality: business.city || null,
      administrativeArea: business.state || null,
      postalCode: business.zipCode || null,
    },
    regularHours: buildGBPHours(business.hours),
    metadata: {
      timezone: business.timezone,
    },
  }
}

/**
 * Push business data to Google Business Profile API.
 * Requires GBP_ACCESS_TOKEN (or GBP_REFRESH_TOKEN) + GBP_ACCOUNT_ID + GBP_LOCATION_ID.
 */
export async function syncBusinessToGoogle(businessId: string): Promise<SyncResult> {
  const accessToken = await getAccessToken()
  const locationPath = getLocationPath()

  if (!accessToken) {
    return {
      success: false,
      syncedFields: [],
      errors: ['No valid GBP access token. Reconnect Google Business Profile.'],
    }
  }

  if (!locationPath) {
    return {
      success: false,
      syncedFields: [],
      errors: ['GBP_ACCOUNT_ID and GBP_LOCATION_ID not configured.'],
    }
  }

  const payload = await prepareBusinessSyncPayload(businessId)
  const syncedFields: string[] = []
  const errors: string[] = []

  const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${locationPath}?updateMask=title,websiteUri,primaryPhone,regularHours`

  try {
    // Patch the location with our business data
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: payload.title,
        websiteUri: payload.websiteUrl,
        primaryPhone: payload.primaryPhone,
        regularHours: payload.regularHours,
      }),
    })

    if (response.ok) {
      syncedFields.push('title', 'websiteUrl', 'primaryPhone', 'regularHours')
    } else {
      const errorData = await response.json().catch(() => ({}))
      errors.push(`Location update failed: ${errorData.error?.message || response.statusText}`)
    }
  } catch (error: any) {
    errors.push(`Sync request failed: ${error.message}`)
  }

  return {
    success: errors.length === 0,
    syncedFields,
    errors,
  }
}

/**
 * Fetch reviews from Google Business Profile and import them into the Review table.
 * GBP API: GET /v1/{location}/reviews
 */
export async function importGoogleReviewsFromAPI(
  businessId: string
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const accessToken = await getAccessToken()
  const locationPath = getLocationPath()

  if (!accessToken || !locationPath) {
    return { imported: 0, skipped: 0, errors: ['GBP not configured or not connected'] }
  }

  const errors: string[] = []
  let imported = 0
  let skipped = 0

  try {
    const response = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationPath}/reviews?pageSize=100`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      errors.push(`Reviews fetch failed: ${errorData.error?.message || response.statusText}`)
      return { imported, skipped, errors }
    }

    const data = await response.json()
    const reviews = data.reviews || []

    for (const gr of reviews) {
      const authorName = gr.reviewer?.displayName || 'Anonymous'
      const rating = gr.starRating === 'FIVE' ? 5 :
                     gr.starRating === 'FOUR' ? 4 :
                     gr.starRating === 'THREE' ? 3 :
                     gr.starRating === 'TWO' ? 2 : 1
      const comment = gr.comment || null
      const createTime = gr.createTime ? new Date(gr.createTime) : new Date()

      // Check if review already exists
      const existing = await prisma.review.findFirst({
        where: {
          businessId,
          authorName,
          createdAt: { gte: createTime },
        },
      })

      if (existing) {
        skipped++
        continue
      }

      await prisma.review.create({
        data: {
          businessId,
          authorName,
          rating,
          comment,
          isGoogleReview: true,
        },
      })
      imported++
    }
  } catch (error: any) {
    errors.push(`Review import error: ${error.message}`)
  }

  return { imported, skipped, errors }
}

/**
 * Import reviews from a provided array (alternative to API fetch).
 */
export async function importGoogleReviews(
  businessId: string,
  googleReviews: any[]
): Promise<{ imported: number; skipped: number }> {
  let imported = 0
  let skipped = 0

  for (const gr of googleReviews) {
    const existing = await prisma.review.findFirst({
      where: {
        businessId,
        authorName: gr.authorName,
        createdAt: { gte: new Date(gr.createTime) },
      },
    })

    if (existing) {
      skipped++
      continue
    }

    await prisma.review.create({
      data: {
        businessId,
        authorName: gr.authorName,
        rating: gr.starRating === 'FIVE' ? 5 :
                gr.starRating === 'FOUR' ? 4 :
                gr.starRating === 'THREE' ? 3 :
                gr.starRating === 'TWO' ? 2 : 1,
        comment: gr.comment || null,
        isGoogleReview: true,
      },
    })
    imported++
  }

  return { imported, skipped }
}

// ─── Config Check ──────────────────────────────────────────────────────────

/**
 * Check if Google Business Profile is configured (OAuth credentials present)
 */
export function isGBPConfigured(): boolean {
  if (!isGoogleEnabled()) return false
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET
  )
}

/**
 * Check if GBP is connected (has a valid access/refresh token + location configured)
 */
export function isGBPConnected(): boolean {
  return !!(
    (process.env.GBP_ACCESS_TOKEN || process.env.GBP_REFRESH_TOKEN) &&
    process.env.GBP_ACCOUNT_ID &&
    process.env.GBP_LOCATION_ID
  )
}

/**
 * Build the OAuth URL for connecting Google Business Profile
 */
export function getGBPOAuthUrl(businessId: string, redirectUri: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID not configured')

  const scopes = [
    'https://www.googleapis.com/auth/business.manage',
  ].join(' ')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state: businessId,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}
