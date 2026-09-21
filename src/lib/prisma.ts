// ============================================================================
// PRISMA CLIENT — Production database connection.
// Requires DATABASE_URL environment variable.
// ============================================================================

import { PrismaClient } from '@prisma/client'

// Neon provisions the Prisma-compatible URL under this integration variable.
// Keep DATABASE_URL as the primary project contract, but use the connected Neon
// URL when DATABASE_URL is unset or blank in a deployment environment.
const databaseUrl = process.env.DATABASE_URL?.trim() || process.env.NEON_POSTGRES_PRISMA_URL?.trim()
if (!databaseUrl && process.env.NODE_ENV === 'production') {
  throw new Error('DATABASE_URL is required in production.')
}
if (databaseUrl && !process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = databaseUrl
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
