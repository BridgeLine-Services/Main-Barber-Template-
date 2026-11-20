/**
 * Configuration auditing (Priority 3, part H).
 *
 * Every organization-level configuration change is recorded with who did it, what it was,
 * what it became, and a sentence a person can read. Values are redacted on the way in, so
 * a secret cannot be stored by accident.
 */

import { redactForHistory } from '@/lib/platform-reliability/maintenance-history'

export interface ConfigChangeInput {
  organizationId: string
  actorId: string | null
  action: string
  entity: string
  entityId?: string | null
  summary: string
  previousValue?: unknown
  newValue?: unknown
  at: string
}

export interface ConfigAuditEntry {
  organizationId: string
  actorId: string | null
  action: string
  entity: string
  entityId: string | null
  summary: string
  previousValue: string | null
  newValue: string | null
  createdAt: string
}

export function buildConfigAuditEntry(input: ConfigChangeInput): ConfigAuditEntry {
  return {
    organizationId: input.organizationId,
    actorId: input.actorId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    summary: redactForHistory(input.summary) ?? input.summary,
    previousValue: redactForHistory(input.previousValue),
    newValue: redactForHistory(input.newValue),
    createdAt: input.at,
  }
}

export interface ConfigChangeSummary {
  headline: string
  changedFields: string[]
}

/** Compare two plain objects and describe what changed, without quoting secret values. */
export function summariseConfigChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null): ConfigChangeSummary {
  if (!before || !after) return { headline: 'A configuration value was set or cleared.', changedFields: [] }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changedFields: string[] = []
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changedFields.push(key)
  }
  return {
    headline: changedFields.length === 0
      ? 'Nothing changed.'
      : `${changedFields.length} setting${changedFields.length === 1 ? '' : 's'} changed: ${changedFields.join(', ')}.`,
    changedFields,
  }
}
