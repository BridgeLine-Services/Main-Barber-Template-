export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MediaType } from '@prisma/client'
import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { handleApiError } from '@/lib/api-errors'
import { validateImageUpload, MIME_TO_EXTENSION } from '@/lib/file-validation'

/**
 * POST /api/dashboard/media/upload
 * Accepts multipart form data with a file and type.
 * Returns the public URL of the uploaded file.
 *
 * Supported types: LOGO, HERO, SHOP_PHOTO, BARBER_PHOTO, BARBER_PORTFOLIO,
 *                  GALLERY, SERVICE_PHOTO, OG_IMAGE, FAVICON
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const role = (session.user as any)?.role
    const businessId = (session.user as any)?.businessId as string | undefined
    const sessionBarberId = (session.user as any)?.barberId
    if (!businessId) return NextResponse.json({ error: 'Business setup required' }, { status: 409 })
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: 'Media storage is not configured. Set BLOB_READ_WRITE_TOKEN in the deployment environment.' }, { status: 503 })
    }
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
    // Validate file size (10MB max) BEFORE buffering the file
    const MAX_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum 10MB.' }, { status: 400 })
    }

    // Content-based validation (Requirement: never trust the client-provided
    // MIME type alone). sniffImageType reads the file's magic bytes and the
    // sniffed type must match the declared type; SVGs are sanitized to strip
    // scripts, event handlers, and javascript:/external-entity vectors.
    let validated: { contentType: string; buffer: Buffer }
    try {
      validated = validateImageUpload(file.type, new Uint8Array(await file.arrayBuffer()))
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'File rejected by validation.' },
        { status: 400 },
      )
    }
    const ext = MIME_TO_EXTENSION[validated.contentType as keyof typeof MIME_TO_EXTENSION]

    // Generate a safe filename using the server-derived extension
    const filename = `${businessId}/${type.toLowerCase()}/${randomUUID()}.${ext}`
    try {
      const blob = await put(filename, validated.buffer, {
        access: 'public',
        contentType: validated.contentType,
        addRandomSuffix: false,
      })
      return NextResponse.json({ url: blob.url, filename: blob.pathname, type })
    } catch (error) {
      console.error('File upload error:', error instanceof Error ? error.message : 'unknown error')
      return NextResponse.json({ error: 'Failed to save file' }, { status: 500 })
    }
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/media/upload')
  }
}
