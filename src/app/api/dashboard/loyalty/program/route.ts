export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { handleApiError } from '@/lib/api-errors'

// GET /api/dashboard/loyalty/program
// Returns the current loyalty program configuration
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const program = await prisma.businessRewardProgram.findFirst({
      where: { businessId, isActive: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!program) {
      return NextResponse.json({
        program: {
          id: null,
          name: '',
          type: 'VISITS',
          tiers: [],
          pointsPerDollar: null,
          isActive: false,
        },
      })
    }
    return NextResponse.json({
      program: {
        id: program.id,
        name: program.name,
        type: program.type,
        tiers: program.config,
        pointsPerDollar: program.pointsPerDollar,
        isActive: program.isActive,
      },
    })
  } catch (error) {
    return handleApiError(error, 'GET /api/dashboard/loyalty/program')
  }
}

// PUT /api/dashboard/loyalty/program
// Creates or updates the loyalty program configuration (owner only)
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const businessId = (session.user as any)?.businessId
    const userRole = (session.user as any)?.role
    const userId = (session.user as any)?.id
    if (userRole !== 'OWNER') {
      return NextResponse.json({ error: 'Only owners can configure loyalty programs' }, { status: 403 })
    }
    const body = await req.json()
    const { name, type, tiers, pointsPerDollar, isActive } = body
    if (!['VISITS', 'POINTS'].includes(type)) {
      return NextResponse.json({ error: 'Type must be VISITS or POINTS' }, { status: 400 })
    }
    if (!Array.isArray(tiers)) {
      return NextResponse.json({ error: 'Tiers must be an array' }, { status: 400 })
    }
    // Deactivate any existing programs
    await prisma.businessRewardProgram.updateMany({
      where: { businessId, isActive: true },
      data: { isActive: false },
    })
    // Create new program
    const program = await prisma.businessRewardProgram.create({
      data: {
        businessId,
        name: name || 'Loyalty Program',
        type,
        isActive: isActive !== false,
        pointsPerDollar: type === 'POINTS' ? (pointsPerDollar || 1) : null,
        config: tiers,
      },
    })
    // Log to audit log
    try {
      await prisma.auditLog.create({
        data: {
          businessId,
          userId,
          action: 'SETTINGS_UPDATED',
          entityType: 'BusinessRewardProgram',
          entityId: program.id,
          newValues: { name, type, tiers, pointsPerDollar, isActive },
        },
      })
    } catch (e) {
      // Non-critical
    }
    return NextResponse.json({
      success: true,
      program: {
        id: program.id,
        name: program.name,
        type: program.type,
        tiers: program.config,
        pointsPerDollar: program.pointsPerDollar,
        isActive: program.isActive,
      },
    })
  } catch (error) {
    return handleApiError(error, 'PUT /api/dashboard/loyalty/program')
  }
}
