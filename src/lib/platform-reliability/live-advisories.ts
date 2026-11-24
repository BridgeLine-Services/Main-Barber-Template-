import { readFileSync } from 'node:fs'
import { buildAdvisory, type RawAdvisory, type SecurityAdvisory } from './advisory-monitor'

const OSV_QUERY_URL = 'https://api.osv.dev/v1/querybatch'
const OSV_SOURCE = 'OSV.dev vulnerability database'
const SUCCESS_CACHE_MS = 15 * 60_000
const FAILURE_CACHE_MS = 60_000
const REQUEST_TIMEOUT_MS = 4_000
const MAX_ATTEMPTS = 2

type PackageJson = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
type Lockfile = { packages?: Record<string, { version?: string }> }
type OsvVulnerability = {
  id?: string
  summary?: string
  details?: string
  aliases?: string[]
  references?: Array<{ url?: string }>
  database_specific?: { severity?: string }
  severity?: Array<{ type?: string; score?: string }>
  affected?: Array<{
    package?: { name?: string; ecosystem?: string }
    ranges?: Array<{ events?: Array<{ introduced?: string; fixed?: string }> }>
  }>
}
type OsvBatchResponse = { results?: Array<{ vulns?: OsvVulnerability[] }> }

export interface LiveAdvisoryCheck {
  source: string
  checkedAt: string
  verified: boolean
  packageCount: number
  advisories: SecurityAdvisory[]
  error: string | null
}

let cached: { expiresAt: number; value: LiveAdvisoryCheck } | null = null
let inFlight: Promise<LiveAdvisoryCheck> | null = null

function readDependencyVersions(): Array<{ name: string; version: string }> {
  const root = process.cwd()
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as PackageJson
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8')) as Lockfile
  const dependencies = Array.from(new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]))
  const installed = dependencies.flatMap((name) => {
    const version = lock.packages?.[`node_modules/${name}`]?.version
    return version ? [{ name, version }] : []
  })
  if (dependencies.length === 0 || installed.length !== dependencies.length) {
    throw new Error('The lockfile does not contain an exact version for every production dependency.')
  }
  return installed
}

function severityFor(vuln: OsvVulnerability): string | undefined {
  const direct = vuln.database_specific?.severity
  if (direct) return direct
  const score = vuln.severity?.find((item) => item.type?.toUpperCase().includes('CVSS'))?.score
  const numeric = score ? Number(score) : Number.NaN
  if (Number.isFinite(numeric)) {
    if (numeric >= 9) return 'critical'
    if (numeric >= 7) return 'high'
    if (numeric >= 4) return 'moderate'
    return 'low'
  }
  return undefined
}

function affectedRange(vuln: OsvVulnerability): string | null {
  for (const affected of vuln.affected ?? []) {
    const listedVersions = (affected as { versions?: string[] }).versions
    if (listedVersions?.length) return `Affected versions: ${listedVersions.slice(0, 8).join(', ')}`
    for (const range of affected.ranges ?? []) {
      const events = range.events ?? []
      if (events.length) {
        return events.map((event) => event.introduced ? `introduced ${event.introduced}` : event.fixed ? `fixed ${event.fixed}` : '').filter(Boolean).join('; ')
      }
    }
  }
  return null
}

function fixedVersion(vuln: OsvVulnerability): string | null {
  for (const affected of vuln.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      const fixed = range.events?.find((event) => event.fixed)?.fixed
      if (fixed && /^\d+\.\d+\.\d+/.test(fixed)) return fixed
    }
  }
  return null
}

async function fetchWithTimeout(fetcher: typeof fetch, url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetcher(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchAdvisories(fetcher: typeof fetch, timeoutMs: number): Promise<LiveAdvisoryCheck> {
  const checkedAt = new Date().toISOString()
  const packages = readDependencyVersions()
  const payload = {
    queries: packages.map(({ name, version }) => ({ package: { name, ecosystem: 'npm' }, version })),
  }
  let lastError = 'The advisory source did not return a usable response.'

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchWithTimeout(fetcher, OSV_QUERY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      }, timeoutMs)
      if (!response.ok) {
        lastError = `The advisory source returned HTTP ${response.status}.`
        if (response.status < 500 && response.status !== 429) break
        continue
      }
      const body = (await response.json()) as OsvBatchResponse
      if (!Array.isArray(body.results) || body.results.length !== packages.length) {
        lastError = 'The advisory source returned incomplete package results.'
        continue
      }
      const advisories: SecurityAdvisory[] = []
      body.results.forEach((result, index) => {
        for (const vuln of result.vulns ?? []) {
          const raw: RawAdvisory = {
            packageName: packages[index].name,
            installedVersion: packages[index].version,
            severity: severityFor(vuln),
            title: vuln.summary || vuln.id || 'Security advisory',
            url: vuln.references?.find((reference) => reference.url)?.url || `https://osv.dev/vulnerability/${encodeURIComponent(vuln.id || '')}`,
            vulnerableRange: affectedRange(vuln) ?? (vuln.id ? `${vuln.id}: OSV confirmed the installed version is affected` : null),
            fixAvailable: fixedVersion(vuln) ? { version: fixedVersion(vuln)! } : false,
          }
          const advisory = buildAdvisory(raw, checkedAt)
          if (vuln.aliases?.length) advisory.title = `${advisory.title} (${vuln.aliases[0]})`
          advisories.push(advisory)
        }
      })
      return { source: OSV_SOURCE, checkedAt, verified: true, packageCount: packages.length, advisories, error: null }
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? 'The advisory source timed out.'
        : 'The advisory source could not be reached or parsed.'
    }
  }
  return { source: OSV_SOURCE, checkedAt, verified: false, packageCount: packages.length, advisories: [], error: lastError }
}

/** Read-only advisory check. Feed failures stay explicitly unverified and are briefly cached. */
export async function checkLiveAdvisories(options: { fetcher?: typeof fetch; force?: boolean; timeoutMs?: number } = {}): Promise<LiveAdvisoryCheck> {
  const now = Date.now()
  if (!options.force && cached && cached.expiresAt > now) return cached.value
  if (!options.force && inFlight) return inFlight

  inFlight = fetchAdvisories(options.fetcher ?? fetch, Math.min(Math.max(options.timeoutMs ?? REQUEST_TIMEOUT_MS, 1), REQUEST_TIMEOUT_MS))
  try {
    const value = await inFlight
    cached = { value, expiresAt: Date.now() + (value.verified ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS) }
    return value
  } catch {
    const value: LiveAdvisoryCheck = {
      source: OSV_SOURCE,
      checkedAt: new Date().toISOString(),
      verified: false,
      packageCount: 0,
      advisories: [],
      error: 'Installed dependency information could not be read.',
    }
    cached = { value, expiresAt: Date.now() + FAILURE_CACHE_MS }
    return value
  } finally {
    inFlight = null
  }
}

export function clearLiveAdvisoryCache(): void {
  cached = null
  inFlight = null
}
