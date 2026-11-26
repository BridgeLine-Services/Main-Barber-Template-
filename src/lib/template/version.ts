/**
 * Template version identity and update detection.
 *
 * A client installation is a copy of this template. Without a record of *which* copy, support
 * cannot answer "is this client behind?" and an update cannot be reasoned about at all. This
 * module is deliberately pure: it builds and compares manifests and describes what an update
 * would involve, and never writes to a client repository or a database.
 *
 * It stores nothing private: no credentials, no customer data, no provider tokens. Only the
 * template version, the source commit, when the copy was made, and the schema fingerprint.
 */

export interface TemplateManifest {
  /** The template release the copy came from, e.g. "1.0.0". */
  templateVersion: string
  /** The exact template commit the copy was made from. */
  sourceCommit: string
  /** ISO date the copy was created. */
  copiedAt: string
  /** Where it came from, for support to verify. */
  sourceRepository: string
  /** Fingerprint of the database schema at copy time, so migrations can be reasoned about. */
  schemaFingerprint: string
  /** Manifest format version, so this file can itself be upgraded later. */
  manifestVersion: number
}

export const MANIFEST_VERSION = 1

export interface ManifestInput {
  templateVersion: string
  sourceCommit: string
  copiedAt?: string
  sourceRepository?: string
  schemaFingerprint: string
}

const COMMIT_SHAPE = /^[0-9a-f]{7,40}$/

export interface BuildResult {
  ok: boolean
  errors: string[]
  manifest?: TemplateManifest
}

/**
 * Build a manifest, refusing the values that would make it useless.
 *
 * A manifest with a placeholder commit is worse than no manifest: it looks like evidence.
 */
export function buildManifest(input: ManifestInput): BuildResult {
  const errors: string[] = []
  if (!input.templateVersion?.trim()) errors.push('A template version is required.')
  if (!COMMIT_SHAPE.test(input.sourceCommit ?? '')) errors.push('The source commit must be a commit hash, not a placeholder.')
  if (!input.schemaFingerprint?.trim()) errors.push('A schema fingerprint is required so migrations can be compared later.')
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    errors: [],
    manifest: {
      manifestVersion: MANIFEST_VERSION,
      templateVersion: input.templateVersion.trim(),
      sourceCommit: input.sourceCommit.trim(),
      copiedAt: input.copiedAt ?? new Date().toISOString(),
      sourceRepository: input.sourceRepository ?? 'BridgeLine-Services/Main-Barber-Template-',
      schemaFingerprint: input.schemaFingerprint.trim(),
    },
  }
}

export interface ManifestProblem {
  field: keyof TemplateManifest | 'manifest'
  message: string
}

/** Is this file usable as a manifest? */
export function validateManifest(value: unknown): ManifestProblem[] {
  if (!value || typeof value !== 'object') return [{ field: 'manifest', message: 'The version file is missing or is not readable.' }]
  const m = value as Partial<TemplateManifest>
  const problems: ManifestProblem[] = []
  if (m.manifestVersion !== MANIFEST_VERSION) problems.push({ field: 'manifestVersion', message: `This version file was written by a different format (${String(m.manifestVersion)}).` })
  if (!m.templateVersion?.trim()) problems.push({ field: 'templateVersion', message: 'The version file does not say which template version this copy came from.' })
  if (!COMMIT_SHAPE.test(m.sourceCommit ?? '')) problems.push({ field: 'sourceCommit', message: 'The version file does not contain a usable commit.' })
  if (!m.schemaFingerprint?.trim()) problems.push({ field: 'schemaFingerprint', message: 'The version file does not contain a schema fingerprint.' })
  return problems
}

export interface VersionParts {
  major: number
  minor: number
  patch: number
}

export function parseVersion(version: string): VersionParts | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec((version ?? '').trim())
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

export type UpdateStatus = 'up-to-date' | 'update-available' | 'ahead' | 'unreadable'

export interface UpdateAssessment {
  status: UpdateStatus
  message: string
  /** Things the person doing the update must deal with before applying it. */
  considerations: string[]
}

/**
 * Compare a client's manifest with the current template.
 *
 * This never says "safe to update". It says what is different and what has to be handled,
 * because the decision belongs to a person who can see the client's customisations.
 */
export function assessUpdate(
  client: TemplateManifest,
  current: { templateVersion: string; sourceCommit: string; schemaFingerprint: string }
): UpdateAssessment {
  const order = compareVersions(client.templateVersion, current.templateVersion)
  if (order === null) {
    return {
      status: 'unreadable',
      message: 'One of the version numbers could not be read, so this copy cannot be compared with the template.',
      considerations: [],
    }
  }

  if (order === 0 && client.sourceCommit === current.sourceCommit) {
    return {
      status: 'up-to-date',
      message: `This copy is the same version as the template (${current.templateVersion}).`,
      considerations: [],
    }
  }

  if (order > 0) {
    return {
      status: 'ahead',
      message: `This copy reports ${client.templateVersion}, which is newer than the template's ${current.templateVersion}. It may contain local work.`,
      considerations: ['Do not overwrite it with the template until somebody has looked at what is different.'],
    }
  }

  const considerations = [
    'Compare the changed files with this copy before applying anything: a client may have customised the same file.',
    'Take a database backup and confirm it can be restored before touching the database.',
  ]
  if (client.schemaFingerprint !== current.schemaFingerprint) {
    considerations.push('The database structure has changed since this copy was made, so migrations will be required.')
  }
  if (order !== 0 && client.sourceCommit !== current.sourceCommit) {
    considerations.push(`The template has moved from ${client.sourceCommit.slice(0, 7)} to ${current.sourceCommit.slice(0, 7)}.`)
  }

  return {
    status: 'update-available',
    message: `This copy is ${client.templateVersion} and the template is ${current.templateVersion}.`,
    considerations,
  }
}
