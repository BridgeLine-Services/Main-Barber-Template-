// Central tenant resolution — production mode (no demo fallback).
import { headers } from 'next/headers'
import { prisma } from './prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth'

export async function getAuthenticatedBusinessId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return session?.user.businessId ?? null
}

/**
 * Resolve the public business for this deployment.
 *
 * Tenant mode is configured with TENANT_MODE (NOT APP_MODE — that variable
 * already owns the production|demo application-mode switch):
 *
 *   - unset (default): zero-config single-shop behavior. Host→slug is tried
 *     first, then SINGLE_BUSINESS_ID, then a guarded sole-business fallback
 *     (only when the deployment has exactly one business). This is what a
 *     fresh cloned deployment and the E2E environment rely on: the public
 *     site works right after onboarding, before any tenant env vars exist.
 *   - 'multi': strict hostname resolution. The request hostname must match a
 *     Business.slug. No sole-business fallback.
 *   - 'single': the deployment binds to SINGLE_BUSINESS_ID. Fail closed when
 *     it is missing or invalid.
 *
 * Any explicitly configured but invalid TENANT_MODE fails closed (the public
 * site is unavailable rather than accidentally binding to the wrong tenant).
 */
export async function resolvePublicBusiness() {
  const configuredMode = process.env.TENANT_MODE?.trim().toLowerCase()
  if (configuredMode && configuredMode !== 'single' && configuredMode !== 'multi') return null

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const hostname = host?.split(':')[0]?.toLowerCase()

  if (configuredMode === 'multi') {
    if (!hostname) return null
    return prisma.business.findUnique({ where: { slug: hostname } }).catch(() => null)
  }

  if (configuredMode === 'single') {
    const configuredBusinessId = process.env.SINGLE_BUSINESS_ID?.trim()
    if (!configuredBusinessId) return null
    return prisma.business.findUnique({ where: { id: configuredBusinessId } }).catch(() => null)
  }

  // TENANT_MODE unset — zero-config single-shop resolution.
  if (hostname) {
    const byHost = await prisma.business.findUnique({ where: { slug: hostname } }).catch(() => null)
    if (byHost) return byHost
  }

  const configuredBusinessId = process.env.SINGLE_BUSINESS_ID?.trim()
  if (configuredBusinessId) {
    return prisma.business.findUnique({ where: { id: configuredBusinessId } }).catch(() => null)
  }

  // Single-shop deployments host on a domain that will not match any business
  // slug (e.g. <project>.vercel.app) and often do not have
  // SINGLE_BUSINESS_ID set yet. Falling back to the sole business keeps the
  // public customer website reachable right after onboarding instead of
  // showing "Shop Coming Soon" while one exists.
  const businessCount = await prisma.business.count().catch(() => 0)
  if (businessCount === 1) {
    const [sole] = await prisma.business.findMany({ take: 1 }).catch(() => [])
    if (sole) return sole
  }

  return null
}

/** Resolve the configured business for a cloned single-business deployment. */
export async function resolveConfiguredBusiness() {
  const businessId = process.env.SINGLE_BUSINESS_ID?.trim()
  if (!businessId) return null
  return prisma.business.findUnique({ where: { id: businessId } }).catch(() => null)
}

/** Return the configured business ID, or explain the missing setup clearly. */
export async function resolveConfiguredBusinessId(): Promise<string> {
  const business = await resolveConfiguredBusiness()
  if (!business) {
    throw new Error('SINGLE_BUSINESS_ID is not configured or does not match a business')
  }
  return business.id
}

/** Resolve the authenticated dashboard tenant. */
export async function getAuthenticatedBusiness() {
  const businessId = await getAuthenticatedBusinessId()
  if (!businessId) return null
  return prisma.business.findUnique({ where: { id: businessId } }).catch(() => null)
}

export async function resolveBusiness() {
  return resolvePublicBusiness()
}

/**
 * True when the currently-resolved public business is soft-deactivated.
 * Deactivated shops keep marketing pages online but must not accept
 * bookings, queue joins, or portal lookups.
 */
export async function isPublicBusinessDeactivated(): Promise<boolean> {
  const business = await resolvePublicBusiness()
  return !business || business.deactivatedAt != null
}

export async function resolveBusinessId(): Promise<string> {
  const business = await resolvePublicBusiness()
  if (!business) throw new Error('Business tenant could not be resolved')
  return business.id
}

export async function resolveAuthenticatedBusinessId(): Promise<string> {
  const businessId = await getAuthenticatedBusinessId()
  if (!businessId) throw new Error('Authenticated business could not be resolved')
  return businessId
}
