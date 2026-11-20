/**
 * The versions actually running, read from the manifest rather than remembered.
 *
 * The compatibility check needs real numbers. Hard-coding them in a second place is how a
 * support report ends up confidently wrong, so they come from package.json and the runtime
 * itself. PostgreSQL is the one version this file cannot know: it is supplied by the caller
 * that can ask the database.
 */

import pkg from '../../../package.json'

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

export function manifestVersions(manifest: Manifest = pkg as Manifest): Record<string, string | null> {
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
  const pick = (name: string): string | null => deps[name] ?? null
  return {
    node: process.version,
    next: pick('next'),
    react: pick('react'),
    prisma: pick('prisma'),
    pg: pick('pg'),
    postgres: null,
  }
}

/** Combine manifest versions with values only a live check can supply. */
export function withLiveVersions(
  base: Record<string, string | null>,
  live: Record<string, string | null | undefined>,
): Record<string, string | null> {
  const merged: Record<string, string | null> = { ...base }
  for (const [key, value] of Object.entries(live)) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value
  }
  return merged
}

/** Extract the major version from a PostgreSQL server_version string such as "15.20". */
export function postgresMajor(serverVersion: string | null | undefined): string | null {
  if (!serverVersion) return null
  const match = /^(\d+)/.exec(serverVersion.trim())
  return match ? match[1] : null
}
