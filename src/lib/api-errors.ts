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

/**
 * Convert a zod validation failure into ONE specific, user-readable message
 * (e.g. "Photo must be a valid URL (https://...)") instead of a vague
 * "Invalid barber data". Returns the fieldErrors map too so callers can
 * include `details` in the response.
 */
export function validationError(error: { flatten(): { fieldErrors: Record<string, string[]> } }): {
  message: string
  fieldErrors: Record<string, string[]>
} {
  const fieldErrors = error.flatten().fieldErrors
  const labels: Record<string, string> = {
    name: 'Name',
    specialty: 'Specialty',
    bio: 'Bio',
    photo: 'Photo',
    email: 'Email',
    password: 'Password',
    description: 'Description',
    duration: 'Duration',
    price: 'Price',
    barberIds: 'Barber selection',
    serviceIds: 'Service selection',
  }
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (messages?.length) {
      const label = labels[field] ?? field
      const detail = messages[0]
      // Zod default "Invalid input" adds nothing — pair it with the label.
      const message = detail === 'Invalid input' || detail === 'Required'
        ? `${label} is invalid or missing`
        : detail
      return { message, fieldErrors }
    }
  }
  return { message: 'Invalid input', fieldErrors }
}
