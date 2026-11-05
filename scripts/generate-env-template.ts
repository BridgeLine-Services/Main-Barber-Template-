#!/usr/bin/env npx tsx
/**
 * Regenerates .env.example from the single environment registry.
 *
 * The template had drifted: 32 variables documented against 52 in use, with the
 * mandatory Upstash pair absent. Generating it from the registry means the
 * documentation cannot fall behind the code again.
 */
import { writeFileSync } from 'node:fs'
import { ENV_REGISTRY } from '../src/lib/env-registry'

const PUBLIC_CATEGORIES = [
  'CORE', 'SECURITY', 'DATABASE', 'STORAGE', 'PAYMENTS', 'EMAIL', 'SMS', 'GOOGLE',
  'SCHEDULED_TASKS', 'OBSERVABILITY', 'TENANT_CONFIGURATION',
]

const header = `# ============================================================================
# Environment template — generated from src/lib/env-registry.ts
#
# This file is the complete list. \`npm run env:check\` and \`npm run env:doctor\`
# report the status of every variable below, and \`npm run client:preflight\`
# refuses to open first-owner registration while a required one is missing.
#
# Nothing here holds a real value. NEVER commit a filled-in copy.
# ============================================================================

`

let out = header
for (const category of PUBLIC_CATEGORIES) {
  const rows = ENV_REGISTRY.filter((spec) => spec.category === category)
  if (rows.length === 0) continue
  out += `# ── ${category} ${'─'.repeat(Math.max(0, 62 - category.length))}\n`
  for (const spec of rows) {
    out += `# ${spec.description}\n`
    if (spec.requiredIn.length > 0) out += `#   required in: ${spec.requiredIn.join(', ')} (at ${spec.requiredAt})\n`
    if (spec.feature) out += `#   required only while the ${spec.feature} feature is enabled\n`
    if (spec.secret) out += '#   secret: yes — never expose this to the browser\n'
    out += `#   obtain: ${spec.howToObtain}\n`
    out += `${spec.name}=\n\n`
  }
}

out += `# ── INTERNAL / TEST ONLY ${'─'.repeat(40)}\n# Never set these on a customer deployment.\n`
for (const spec of ENV_REGISTRY.filter((s) => ['INTERNAL', 'DEVELOPMENT_ONLY'].includes(s.category))) {
  out += `# ${spec.description}\n${spec.name}=\n`
}

out += `
# ── RETIRED ${'─'.repeat(52)}
# OWNER_PROVISIONING_TOKEN is no longer read by the application. If it exists in
# your deployment, delete it: it has no effect and only invites confusion.
`

writeFileSync('.env.example', out)
const count = out.split('\n').filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line)).length
console.log(`.env.example regenerated with ${count} variables.`)
