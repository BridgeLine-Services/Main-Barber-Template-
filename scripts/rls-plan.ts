#!/usr/bin/env node
/**
 * RLS coverage plan (read-only).
 *
 *   npx tsx scripts/rls-plan.ts            # print the classification table
 *   npx tsx scripts/rls-plan.ts --json     # machine-readable
 *   npx tsx scripts/rls-plan.ts --check    # exit 1 if any model is unclassified
 *
 * Classifies every Prisma model into tenant root / directly scoped / indirectly
 * scoped / global, using the schema itself rather than a hand-maintained list.
 * A new model therefore shows up here the moment it is added, and `--check`
 * fails instead of letting it escape protection silently.
 *
 * It changes nothing: no SQL is executed and no policy is applied. The staged
 * sequence that would apply them is docs/RLS-STAGING-PLAN.md.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

interface ModelInfo {
  name: string
  body: string
  fields: Array<{ name: string; type: string; isRelation: boolean }>
}

function parseModels(schema: string): ModelInfo[] {
  const models: ModelInfo[] = []
  const re = /^model\s+(\w+)\s*\{/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(schema))) {
    const start = match.index + match[0].length
    const end = schema.indexOf('\n}', start)
    const body = schema.slice(start, end)
    const fields: ModelInfo['fields'] = []
    for (const raw of body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@') || line.startsWith('///')) continue
      const field = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?/)
      if (!field) continue
      const type = field[2]
      const isRelation = /@relation/.test(line) || /^[A-Z]/.test(type)
      fields.push({ name: field[1], type, isRelation })
    }
    models.push({ name: match[1], body, fields })
  }
  return models
}

/** Global tables: identity, platform operations, sessions, jobs, audit of the platform itself. */
const GLOBAL = new Set([
  'User', 'BackupRun', 'PlatformSetting', 'UserSession', 'VerificationToken',
  'PasswordResetToken', 'SystemJob', 'JobLock', 'CronRun', 'RateLimitCounter',
  'StripeEvent', 'WebhookEvent', 'JobExecution', 'NotificationDispatch',
  // Platform recovery evidence: belongs to no shop and to no organization.
  'RestoreDrill',
])

/** Known indirect paths when the child has neither businessId nor a direct parent. */
const INDIRECT_PARENT: Record<string, string> = {
  AppointmentItem: 'Appointment',
  PaymentItem: 'Payment',
  CommissionEntry: 'Barber',
  TimeClockEntry: 'Barber',
  ProductImage: 'Product',
  ServiceAddOn: 'Service',
}

/**
 * The organization layer (migration 20261120150000) sits above the shop. Its rows are keyed
 * on the organization, so a shop-scoped policy would either hide them or expose them. They
 * are classified separately and policed with `app.current_organization_id`.
 */
const ORGANIZATION_ROOT = 'Organization'

export type RlsClass = 'tenant_root' | 'direct' | 'indirect' | 'organization_root' | 'organization' | 'global' | 'unclassified'

export interface RlsPlanRow {
  model: string
  classification: RlsClass
  via?: string
}

export function classify(models: ModelInfo[]): RlsPlanRow[] {
  const byName = new Map(models.map((model) => [model.name, model]))
  const rows: RlsPlanRow[] = []
  for (const model of models) {
    if (GLOBAL.has(model.name)) { rows.push({ model: model.name, classification: 'global' }); continue }
    if (model.name === 'Business') { rows.push({ model: model.name, classification: 'tenant_root' }); continue }
    if (model.name === ORGANIZATION_ROOT) { rows.push({ model: model.name, classification: 'organization_root' }); continue }
    const hasOrganizationId = model.fields.some((field) => field.name === 'organizationId')
    if (hasOrganizationId) { rows.push({ model: model.name, classification: 'organization', via: 'organizationId' }); continue }
    const hasBusinessId = model.fields.some((field) => field.name === 'businessId')
    if (hasBusinessId) { rows.push({ model: model.name, classification: 'direct' }); continue }
    const parentName = INDIRECT_PARENT[model.name]
    const parent = parentName ? byName.get(parentName) : undefined
    const relation = model.fields.find((field) => field.isRelation && field.type === parentName)
    if (parent && relation && parent.fields.some((field) => field.name === 'businessId')) {
      rows.push({ model: model.name, classification: 'indirect', via: `${parentName}.businessId` })
      continue
    }
    // Last resort: a relation to any model that is itself directly scoped.
    const scopedParent = model.fields.find((field) => {
      const target = byName.get(field.type)
      return field.isRelation && target?.fields.some((f) => f.name === 'businessId')
    })
    if (scopedParent) {
      rows.push({ model: model.name, classification: 'indirect', via: `${scopedParent.type}.businessId` })
      continue
    }
    rows.push({ model: model.name, classification: 'unclassified' })
  }
  return rows
}

function main() {
  const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma')
  const rows = classify(parseModels(readFileSync(schemaPath, 'utf8')))
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1
    return acc
  }, {})

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ counts, rows }, null, 2))
  } else {
    for (const row of rows) {
      console.log(`${row.classification.padEnd(13)} ${row.model}${row.via ? `  (via ${row.via})` : ''}`)
    }
    console.log('')
    console.log(`tenant root: ${counts.tenant_root ?? 0}`)
    console.log(`directly scoped: ${counts.direct ?? 0}`)
    console.log(`indirectly scoped: ${counts.indirect ?? 0}`)
    console.log(`organization root: ${counts.organization_root ?? 0}`)
    console.log(`organization scoped: ${counts.organization ?? 0}`)
    console.log(`global: ${counts.global ?? 0}`)
    console.log(`unclassified: ${counts.unclassified ?? 0}`)
  }

  if (process.argv.includes('--check') && (counts.unclassified ?? 0) > 0) {
    console.error('\nEvery model must be classified before RLS can be planned. Add it to GLOBAL, INDIRECT_PARENT or the organization key with a reason.')
    process.exit(1)
  }
}

if (process.argv[1] && /rls-plan\.(ts|js|mts|mjs)$/.test(process.argv[1])) main()
