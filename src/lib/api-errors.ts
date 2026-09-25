import { NextResponse } from 'next/server'

/**
 * Shared API error handling for dashboard routes.
 *
 * Every dashboard route must return valid JSON on EVERY path (200/400/401/403/
 * 404/409/500/503) so the frontend never receives an empty or HTML error body
 * when it expects JSON. This helper maps known Prisma failure codes to useful
 * status codes and safe, generic messages. Raw error details (which can
 * contain connection strings, table names, or stack traces) are logged
 * server-side only and are NEVER included in the response.
 */

interface PrismaLikeError {
  code?: string
  message?: string
}

export function handleApiError(error: unknown, context: string): NextResponse {
  const err = (error ?? {}) as PrismaLikeError
  // Server-side diagnostics only — never sent to the client.
  console.error(`[api] ${context}:`, err.code ?? 'NO_CODE', err.message ?? error)

  // Database unreachable / connection dropped
  if (err.code === 'P1001' || err.code === 'P1017' || err.code === 'P1003') {
    return NextResponse.json(
      { error: 'This service is temporarily unavailable. Please try again in a moment.' },
      { status: 503 }
    )
  }

  // Unique constraint violation (duplicate email, slug, etc.)
  if (err.code === 'P2002') {
    return NextResponse.json(
      { error: 'A record with that information already exists. Please use a different value.' },
      { status: 409 }
    )
  }

  // Record required by a mutation no longer exists
  if (err.code === 'P2025') {
    return NextResponse.json({ error: 'That record no longer exists. Refresh and try again.' }, { status: 404 })
  }

  // Foreign key violation (e.g. linking to a record outside this tenant)
  if (err.code === 'P2003') {
    return NextResponse.json(
      { error: 'One of the selected records is no longer available. Refresh and try again.' },
      { status: 409 }
    )
  }

  return NextResponse.json(
    { error: 'Something went wrong on our end. Please try again.' },
    { status: 500 }
  )
}
