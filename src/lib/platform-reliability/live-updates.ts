import { readFileSync } from 'node:fs'
import { buildUpdatePlan, type DependencyState, type UpdatePlan } from './update-plan'

const REGISTRY_TIMEOUT_MS = 3_500
const SUCCESS_CACHE_MS = 6 * 60 * 60_000
const FAILURE_CACHE_MS = 5 * 60_000
const MAX_ATTEMPTS = 2

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
type Lockfile = { packages?: Record<string, { version?: string }> }
type RegistryVersion = { version?: string }

export interface LiveUpdateCheck {
  checkedAt: string
  source: 'npm registry'
  verified: boolean
  packageCount: number
  dependencies: DependencyState[]
  plan: UpdatePlan | null
  error: string | null
}

let cached: { expiresAt: number; value: LiveUpdateCheck } | null = null
let inFlight: Promise<LiveUpdateCheck> | null = null

function installedVersions(): Array<{ name: string; version: string; runtime: boolean }> {
  const root = process.cwd()
  const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as Manifest
  const lock = JSON.parse(readFileSync(`${root}/package-lock.json`, 'utf8')) as Lockfile
  const runtimeNames = new Set(Object.keys(manifest.dependencies ?? {}))
  const names = Array.from(new Set([...runtimeNames, ...Object.keys(manifest.devDependencies ?? {})]))
  const packages = names.flatMap((name) => {
    const version = lock.packages?.[`node_modules/${name}`]?.version
    return version ? [{ name, version, runtime: runtimeNames.has(name) }] : []
  })
  if (!names.length || packages.length !== names.length) {
    throw new Error('The lockfile is missing one or more exact production dependency versions.')
  }
  return packages
}

async function requestLatest(fetcher: typeof fetch, packageName: string, timeoutMs: number): Promise<string> {
  const encodedName = packageName.replaceAll('/', '%2f')
  let lastError = 'The npm registry did not return a latest version.'
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(`https://registry.npmjs.org/${encodedName}/latest`, {
        headers: { accept: 'application/json' }, signal: controller.signal,
      })
      if (!response.ok) {
        lastError = `npm registry returned HTTP ${response.status} for ${packageName}.`
        if (response.status < 500 && response.status !== 429) break
        continue
      }
      const data = (await response.json()) as RegistryVersion
      if (typeof data.version === 'string' && data.version.trim()) return data.version.trim()
      lastError = `npm registry did not include a version for ${packageName}.`
    } catch (error) {
      lastError = error instanceof Error && error.name === 'AbortError'
        ? 'The npm registry timed out.'
        : 'The npm registry could not be reached or parsed.'
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(lastError)
}

async function fetchUpdateCheck(fetcher: typeof fetch, timeoutMs: number, advisoryPackages: Set<string>): Promise<LiveUpdateCheck> {
  const checkedAt = new Date().toISOString()
  const installed = installedVersions()
  const outcomes = await Promise.all(installed.map(async (item) => {
    try {
      const latest = await requestLatest(fetcher, item.name, timeoutMs)
      return { item, latest, error: null as string | null }
    } catch (error) {
      return { item, latest: null, error: error instanceof Error ? error.message : 'The npm registry could not be checked.' }
    }
  }))
  const dependencies = outcomes.flatMap(({ item, latest }) => latest
    ? [{ name: item.name, installed: item.version, latest, hasAdvisory: advisoryPackages.has(item.name), runtime: item.runtime }]
    : [])
  const failed = outcomes.filter((outcome) => outcome.error)
  const verified = failed.length === 0
  const plan = verified
    ? buildUpdatePlan(dependencies.filter((dependency) => dependency.installed !== dependency.latest), checkedAt)
    : null
  return {
    checkedAt,
    source: 'npm registry',
    verified,
    packageCount: installed.length,
    dependencies,
    plan,
    error: verified ? null : `${failed.length} of ${installed.length} package version checks could not be completed.`,
  }
}

/** Checks latest stable registry tags with bounded per-request timeouts and one retry. */
export async function checkLiveUpdates(options: {
  fetcher?: typeof fetch
  force?: boolean
  timeoutMs?: number
  advisoryPackages?: string[]
} = {}): Promise<LiveUpdateCheck> {
  const now = Date.now()
  if (!options.force && cached && cached.expiresAt > now) return cached.value
  if (!options.force && inFlight) return inFlight
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? REGISTRY_TIMEOUT_MS, 1), REGISTRY_TIMEOUT_MS)
  inFlight = fetchUpdateCheck(fetcher, timeoutMs, new Set(options.advisoryPackages ?? []))
  try {
    const value = await inFlight
    cached = { value, expiresAt: Date.now() + (value.verified ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS) }
    return value
  } catch {
    const value: LiveUpdateCheck = {
      checkedAt: new Date().toISOString(), source: 'npm registry', verified: false,
      packageCount: 0, dependencies: [], plan: null,
      error: 'Installed dependency versions could not be read.',
    }
    cached = { value, expiresAt: Date.now() + FAILURE_CACHE_MS }
    return value
  } finally {
    inFlight = null
  }
}

export function clearLiveUpdateCache(): void {
  cached = null
  inFlight = null
}
