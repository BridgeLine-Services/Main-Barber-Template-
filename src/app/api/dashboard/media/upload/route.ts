export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MediaType } from '@prisma/client'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'

/**
 * POST /api/dashboard/media/upload
 * Accepts multipart form data with a file and type.
 * Returns the public URL of the uploaded file.
 *
 * Supported types: LOGO, HERO, SHOP_PHOTO, BARBER_PHOTO, BARBER_PORTFOLIO,
 *                  GALLERY, SERVICE_PHOTO, OG_IMAGE, FAVICON
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = (session.user as any)?.role
  const businessId = (session.user as any)?.businessId as string | undefined
  const sessionBarberId = (session.user as any)?.barberId

  if (!businessId) return NextResponse.json({ error: 'Business setup required' }, { status: 409 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as MediaType | null

  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (!type || !Object.values(MediaType).includes(type)) {
    return NextResponse.json({ error: 'Valid media type required' }, { status: 400 })
  }

  // BARBER role: can only upload BARBER_PHOTO or BARBER_PORTFOLIO
  if (role === 'BARBER') {
    if (!sessionBarberId) return NextResponse.json({ error: 'No barber profile' }, { status: 403 })
    if (type !== MediaType.BARBER_PHOTO && type !== MediaType.BARBER_PORTFOLIO) {
      return NextResponse.json({ error: 'Barbers can only upload their own photos' }, { status: 403 })
    }
  }

  // Validate file type
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/svg+xml']
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type. Use JPEG, PNG, WebP, AVIF, or SVG.' }, { status: 400 })
  }

  // Map MIME types to safe extensions (do NOT use user-supplied extension)
  const mimeToExt: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
  }

  const ext = mimeToExt[file.type] || 'jpg'

  // Validate file size (10MB max)
  const MAX_SIZE = 10 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large. Maximum 10MB.' }, { status: 400 })
  }

  // Generate a safe filename using server-derived extension
  const filename = `${businessId}/${type.toLowerCase()}/${randomUUID()}.${ext}`

  try {
    const blob = await put(filename, file, {
      access: 'public',
      contentType: file.type,
      addRandomSuffix: false,
    })

    return NextResponse.json({ url: blob.url, filename: blob.pathname, type })
  } catch (error) {
    console.error('File upload error:', error instanceof Error ? error.message : 'unknown error')
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
  }
}
