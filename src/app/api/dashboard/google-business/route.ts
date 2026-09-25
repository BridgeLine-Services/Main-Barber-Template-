import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { handleApiError } from '@/lib/api-errors'
import {
  isGBPConfigured,
  isGBPConnected,
  prepareBusinessSyncPayload,
  getGBPOAuthUrl,
  syncBusinessToGoogle,
  importGoogleReviewsFromAPI,
} from '@/lib/google-business'

// GET /api/dashboard/google-business — check connection status and get OAuth URL
export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const configured = isGBPConfigured()
    const connected = isGBPConnected()
    const redirectUri = `${new URL(request.url).origin}/api/dashboard/google-business/callback`
    let oauthUrl: string | null = null
    if (configured) {
      try {
        oauthUrl = getGBPOAuthUrl(user.id, user.businessId, redirectUri)
      } catch {
        oauthUrl = null
      }
    }
    // Prepare sync payload preview
    let syncPreview: any = null
    try {
      syncPreview = await prepareBusinessSyncPayload(user.businessId)
    } catch {
      syncPreview = null
    }
    return NextResponse.json({
      configured,
      connected,
      oauthUrl,
      syncPreview,
      accountId: process.env.GBP_ACCOUNT_ID || null,
      locationId: process.env.GBP_LOCATION_ID || null,
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/google-business')
  }
}

// POST /api/dashboard/google-business — trigger a real sync to GBP
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const user = session.user as any
    if (user.role !== 'OWNER') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!isGBPConnected()) {
      return NextResponse.json({
        error: 'Google Business Profile not connected. Complete OAuth first.',
      }, { status: 400 })
    }
    try {
      // Determine action from query param: sync or import-reviews
      const { searchParams } = new URL(request.url)
      const action = searchParams.get('action') || 'sync'
      if (action === 'import-reviews') {
        const result = await importGoogleReviewsFromAPI(user.businessId)
        return NextResponse.json({
          success: true,
          action: 'import-reviews',
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors,
        })
      }
      // Default: sync business info to GBP
      const result = await syncBusinessToGoogle(user.businessId)
      return NextResponse.json({
        success: result.success,
        action: 'sync',
        syncedFields: result.syncedFields,
        errors: result.errors,
      })
    } catch (error: any) {
      console.error('GBP sync error:', error)
      return NextResponse.json({ error: 'Failed to sync with Google Business Profile' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/google-business')
  }
}
