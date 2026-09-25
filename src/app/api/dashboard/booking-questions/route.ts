import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireOwner, getBusinessIdForUser } from '@/lib/auth-helpers'
import { bookingQuestionSchema } from '@/lib/validation'
import { handleApiError } from '@/lib/api-errors'

export async function POST(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
    const parsed = bookingQuestionSchema.safeParse(await req.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid question', details: parsed.error.flatten() }, { status: 400 })
    const question = await prisma.bookingQuestion.create({ data: { businessId, ...parsed.data } })
    return NextResponse.json({ question }, { status: 201 })
  } catch (error) {
    return handleApiError(error, 'POST /api/dashboard/booking-questions')
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
    const body = await req.json()
    const id = typeof body.id === 'string' ? body.id : ''
    const parsed = bookingQuestionSchema.partial().safeParse(body)
    if (!id || !parsed.success) return NextResponse.json({ error: 'Invalid question update' }, { status: 400 })
    const existing = await prisma.bookingQuestion.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    const question = await prisma.bookingQuestion.update({ where: { id }, data: parsed.data })
    return NextResponse.json({ question })
  } catch (error) {
    return handleApiError(error, 'PATCH /api/dashboard/booking-questions')
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireOwner()
    if (!auth.success) return auth.response
    const businessId = await getBusinessIdForUser(auth.user)
    const id = new URL(req.url).searchParams.get('id') || ''
    const existing = await prisma.bookingQuestion.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    await prisma.bookingQuestion.update({ where: { id }, data: { isActive: false } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return handleApiError(error, 'DELETE /api/dashboard/booking-questions')
  }
}
