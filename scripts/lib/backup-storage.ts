// ============================================================================
// Provider-neutral backup storage.
//
// The off-site copy must not live in the same account or bucket as the database
// provider's own backups — otherwise a billing failure, a compromised account,
// or a deleted project takes both copies with it. This module is the seam: the
// backup pipeline only ever calls put/get/head/list/delete, so a deployment can
// use S3, Cloudflare R2, Backblaze B2, MinIO, or a mounted directory without a
// code change and without a new SDK dependency (SigV4 is implemented here with
// node:crypto — three operations, no vendored client).
//
// Secrets: credentials are read from the environment, never logged, never
// included in thrown messages, and never written to a manifest.
// ============================================================================

import { createHash, createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

export interface StoredObject {
  key: string
  size: number
  lastModified?: string
}

export interface BackupStorage {
  /** Short driver name recorded in manifests ("s3", "localfs"). */
  readonly driver: string
  /** Human-readable destination that is safe to log (never a credential). */
  readonly destination: string
  put(key: string, body: Buffer): Promise<void>
  get(key: string): Promise<Buffer>
  head(key: string): Promise<StoredObject | null>
  list(prefix: string): Promise<StoredObject[]>
  delete(key: string): Promise<void>
}

export class BackupStorageError extends Error {
  constructor(message: string, readonly missing: string[] = []) {
    super(message)
    this.name = 'BackupStorageError'
  }
}

export interface StorageEnv {
  [key: string]: string | undefined
}

export const STORAGE_ENV_NAMES = [
  'BACKUP_STORAGE_DRIVER',
  'BACKUP_LOCAL_DIR',
  'BACKUP_S3_ENDPOINT',
  'BACKUP_S3_REGION',
  'BACKUP_S3_BUCKET',
  'BACKUP_S3_ACCESS_KEY_ID',
  'BACKUP_S3_SECRET_ACCESS_KEY',
] as const

// ── localfs ─────────────────────────────────────────────────────────────────
// Used for self-hosted deployments with a mounted volume, and by the test
// suites (a temp directory is an honest storage target: the pipeline exercises
// the same put/head/get/delete path it uses in production).

export function createLocalStorage(rootDir: string): BackupStorage {
  const root = resolve(rootDir)
  const pathFor = (key: string) => {
    const full = resolve(root, key)
    // Refuse traversal: a manifest key is data, and a key of "../../etc/x"
    // must not be able to write outside the configured directory.
    if (full !== root && !full.startsWith(root + sep)) {
      throw new BackupStorageError(`Refusing a storage key outside the backup directory: ${key}`)
    }
    return full
  }
  return {
    driver: 'localfs',
    destination: root,
    async put(key, body) {
      const full = pathFor(key)
      mkdirSync(dirname(full), { recursive: true })
      // Write then rename, so an interrupted write never leaves a half object
      // where a complete one is expected.
      const temp = `${full}.partial-${process.pid}`
      writeFileSync(temp, body)
      renameSync(temp, full)
    },
    async get(key) {
      const full = pathFor(key)
      if (!existsSync(full)) throw new BackupStorageError(`Backup object not found: ${key}`)
      return readFileSync(full)
    },
    async head(key) {
      const full = pathFor(key)
      if (!existsSync(full)) return null
      const stat = statSync(full)
      return { key, size: stat.size, lastModified: stat.mtime.toISOString() }
    },
    async list(prefix) {
      const results: StoredObject[] = []
      const walk = (dir: string, rel: string) => {
        if (!existsSync(dir)) return
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const nextRel = rel ? `${rel}/${entry.name}` : entry.name
          const full = join(dir, entry.name)
          if (entry.isDirectory()) walk(full, nextRel)
          else if (nextRel.startsWith(prefix)) {
            const stat = statSync(full)
            results.push({ key: nextRel, size: stat.size, lastModified: stat.mtime.toISOString() })
          }
        }
      }
      walk(root, '')
      return results.sort((a, b) => a.key.localeCompare(b.key))
    },
    async delete(key) {
      const full = pathFor(key)
      if (existsSync(full)) rmSync(full)
    },
  }
}

// ── S3-compatible (SigV4) ───────────────────────────────────────────────────

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle?: boolean
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function amzDates(now: Date) {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

function encodeKeyPath(key: string): string {
  return key.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

/**
 * Minimal SigV4 signer for the four object operations the backup pipeline uses.
 * Vendoring a full AWS SDK for this would add ~10 MB of dependencies and a
 * second credential resolver to a template that must stay auditable.
 */
export function signS3Request(params: {
  method: 'PUT' | 'GET' | 'HEAD' | 'DELETE'
  url: URL
  payloadHash: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  now?: Date
  extraHeaders?: Record<string, string>
}): Record<string, string> {
  const now = params.now ?? new Date()
  const { amzDate, dateStamp } = amzDates(now)
  const headers: Record<string, string> = {
    host: params.url.host,
    'x-amz-content-sha256': params.payloadHash,
    'x-amz-date': amzDate,
    ...(params.extraHeaders ?? {}),
  }
  const sortedKeys = Object.keys(headers).sort()
  const canonicalHeaders = sortedKeys.map((name) => `${name}:${headers[name].trim()}\n`).join('')
  const signedHeaders = sortedKeys.join(';')
  const canonicalRequest = [
    params.method,
    params.url.pathname,
    params.url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    params.payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest, 'utf8').digest('hex'),
  ].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${params.secretAccessKey}`, dateStamp), params.region), 's3'), 'aws4_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
}

export function createS3Storage(config: S3Config): BackupStorage {
  const endpoint = config.endpoint.replace(/\/$/, '')
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  const basePath = () => {
    const base = new URL(endpoint)
    if (config.forcePathStyle !== false) base.pathname = `/${config.bucket}`
    return base
  }
  const objectUrl = (key: string) => {
    const url = basePath()
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeKeyPath(key)}`
    return url
  }
  const bucketUrl = () => {
    const url = basePath()
    url.pathname = url.pathname.replace(/\/$/, '')
    return url
  }
  const call = async (
    method: 'PUT' | 'GET' | 'HEAD' | 'DELETE',
    url: URL,
    body?: Buffer,
  ): Promise<Response> => {
    const payloadHash = createHash('sha256').update(body ?? Buffer.alloc(0)).digest('hex')
    const headers = signS3Request({
      method,
      url,
      payloadHash,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    })
    const response = await fetchImpl(url, {
      method,
      // Buffer is a valid body at runtime; the DOM typing only knows BodyInit.
      body: body ? (body as unknown as BodyInit) : undefined,
      headers: {
        ...headers,
        ...(body ? { 'content-length': String(body.length) } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    })
    return response
  }
  const destination = `${config.endpoint.replace(/^https?:\/\//, '')}/${config.bucket}`
  return {
    driver: 's3',
    destination,
    async put(key, body) {
      const response = await call('PUT', objectUrl(key), body)
      if (!response.ok) throw new BackupStorageError(`Storage rejected the upload (HTTP ${response.status}).`)
    },
    async get(key) {
      const response = await call('GET', objectUrl(key))
      if (!response.ok) throw new BackupStorageError(`Storage could not return ${key} (HTTP ${response.status}).`)
      return Buffer.from(await response.arrayBuffer())
    },
    async head(key) {
      const response = await call('HEAD', objectUrl(key))
      if (response.status === 404) return null
      if (!response.ok) throw new BackupStorageError(`Storage could not confirm ${key} (HTTP ${response.status}).`)
      const length = Number(response.headers.get('content-length') ?? '0')
      return { key, size: Number.isFinite(length) ? length : 0 }
    },
    async list(prefix) {
      // ListObjectsV2. Kept to one page per prefix (1000 objects) because the
      // retention job only inspects the database-backup prefix, which holds a
      // few dozen objects; paging here would add untested complexity.
      const url = bucketUrl()
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', prefix)
      const response = await call('GET', url)
      if (!response.ok) throw new BackupStorageError(`Storage could not list backups (HTTP ${response.status}).`)
      const xml = await response.text()
      const objects: StoredObject[] = []
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const block = match[1]
        const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]
        const size = block.match(/<Size>(\d+)<\/Size>/)?.[1]
        const modified = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1]
        if (key) objects.push({ key, size: Number(size ?? 0), lastModified: modified })
      }
      return objects
    },
    async delete(key) {
      const response = await call('DELETE', objectUrl(key))
      if (!response.ok && response.status !== 404) {
        throw new BackupStorageError(`Storage could not delete ${key} (HTTP ${response.status}).`)
      }
    },
  }
}

/**
 * Build the configured storage, or explain precisely which setting is missing.
 * A missing off-site destination is a configuration gap, not an outage: callers
 * report it as "not configured" and let the primary backup proceed.
 */
export function createStorageFromEnv(env: StorageEnv = process.env): BackupStorage {
  const driver = (env.BACKUP_STORAGE_DRIVER ?? '').trim().toLowerCase()
  if (!driver) {
    throw new BackupStorageError(
      'Off-site backups are not configured (BACKUP_STORAGE_DRIVER is unset).',
      ['BACKUP_STORAGE_DRIVER'],
    )
  }
  if (driver === 'localfs') {
    const dir = env.BACKUP_LOCAL_DIR?.trim()
    if (!dir) {
      throw new BackupStorageError('BACKUP_LOCAL_DIR is required when BACKUP_STORAGE_DRIVER=localfs.', ['BACKUP_LOCAL_DIR'])
    }
    return createLocalStorage(dir)
  }
  if (driver === 's3') {
    const required = [
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
    ] as const
    const missing = required.filter((name) => !env[name]?.trim())
    if (missing.length > 0) {
      throw new BackupStorageError(
        `Off-site S3 storage is missing ${missing.length} setting${missing.length === 1 ? '' : 's'}.`,
        missing,
      )
    }
    return createS3Storage({
      endpoint: env.BACKUP_S3_ENDPOINT!.trim(),
      region: env.BACKUP_S3_REGION?.trim() || 'auto',
      bucket: env.BACKUP_S3_BUCKET!.trim(),
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!.trim(),
      forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE !== 'false',
    })
  }
  throw new BackupStorageError(
    `Unsupported BACKUP_STORAGE_DRIVER "${driver}". Use "s3" or "localfs".`,
    ['BACKUP_STORAGE_DRIVER'],
  )
}
