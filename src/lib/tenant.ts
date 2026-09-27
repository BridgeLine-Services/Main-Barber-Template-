// Central tenant resolution — production mode (no demo fallback).
import { headers } from 'next/headers'
import { prisma } from './prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from './auth'

export async function getAuthenticatedBusinessId(): Promise<string | null> {
  const session = await getServerSession(authOptions)
  return (session?.user as any)?.businessId ?? null
}

/**
 * Resolve the public business for this deployment.
 *
 * A cloned client deployment can set SINGLE_BUSINESS_ID and avoid requiring
 * hostnames to match the database slug. Host resolution remains first so the
 * template preserves its multi-business-safe behavior when that is needed.
 */
export async function resolvePublicBusiness() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const hostname = host?.split(':')[0]?.toLowerCase()

  if (hostname) {
    const byHost = await prisma.business.findUnique({ where: { slug: hostname } }).catch(() => null)
    if (byHost) return byHost
  }

  const configuredBusinessId = process.env.SINGLE_BUSINESS_ID?.trim()
  if (!configuredBusinessId) return null

  return prisma.business.findUnique({ where: { id: configuredBusinessId } }).catch(() => null)
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
