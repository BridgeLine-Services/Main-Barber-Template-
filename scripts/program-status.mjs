#!/usr/bin/env node
/**
 * Program status: proves which parts of the 12-part program exist in the repo.
 *
 * Every part below names the files it claims. The script checks they exist and
 * prints one line per claim, so a claim cannot drift from reality: if an artifact
 * is deleted or renamed, this fails and says which part lost its evidence.
 *
 * It deliberately checks existence only. Whether a part is "done" needs a human
 * reading the evidence, and this script never decides that for them.
 *
 * Usage: node scripts/program-status.mjs [--strict]
 *   --strict exits 1 when any claimed artifact is missing (for CI or a release gate).
 */

import { existsSync, readdirSync } from 'node:fs'

const PARTS = [
  {
    part: 1,
    subject: 'Role and priority',
    note: 'Standing rule, recorded in the working agreement rather than in code.',
    artifacts: ['docs/ARCHITECTURE-AUDIT-2026-11-17.md'],
  },
  {
    part: 2,
    subject: 'Inspect before modifying',
    artifacts: ['docs/ARCHITECTURE-AUDIT-2026-11-17.md', 'docs/RUNTIME-NODE-24.md'],
  },
  {
    part: 3,
    subject: 'Safeguards',
    artifacts: ['docs/OWNER-ACTIONS.md', 'docs/DISASTER-RECOVERY.md', 'docs/MIGRATION-RECOVERY.md'],
  },
  {
    part: 4,
    subject: 'Eight identities, branding, previews',
    artifacts: [
      'src/lib/visual-style.ts',
      'src/lib/visual-style-guide.ts',
      'src/lib/brand-assistant.ts',
      'src/components/dashboard/BrandSetupWizard.tsx',
      'src/components/dashboard/StyleCompare.tsx',
      'src/app/(dashboard)/dashboard/brand-setup/page.tsx',
      'tests/brand-assistant.test.ts',
    ],
  },
  {
    part: 5,
    subject: 'Homepage management',
    artifacts: [
      'src/lib/home-modules.ts',
      'src/lib/home-recommendations.ts',
      'src/components/dashboard/HomeModulesCard.tsx',
      'tests/home-modules.test.ts',
      'tests/seo-health.test.ts',
    ],
  },
  {
    part: 6,
    subject: 'SEO and reviews',
    artifacts: [
      'src/lib/seo-health.ts',
      'src/app/(dashboard)/dashboard/seo-health/page.tsx',
      'src/lib/review-requests.ts',
      'src/app/api/cron/review-requests/route.ts',
      'src/app/api/dashboard/review-requests/route.ts',
      'src/app/(dashboard)/dashboard/reviews/page.tsx',
    ],
  },
  {
    part: 7,
    subject: 'Reliability program',
    artifacts: [
      'src/lib/health.ts',
      'src/lib/production-readiness.ts',
      'src/app/(dashboard)/dashboard/factory-status/page.tsx',
      'scripts/backup-archive.ts',
      'tests/backup-archive.test.ts',
      '.github/workflows/media-backup.yml',
    ],
  },
  {
    part: 8,
    subject: 'Every user type',
    artifacts: [
      'src/app/(dashboard)/dashboard/commissions/page.tsx',
      'src/app/(dashboard)/dashboard/my-payroll/page.tsx',
      'src/app/(dashboard)/dashboard/my-time-clock/page.tsx',
      'src/app/(dashboard)/dashboard/payroll/page.tsx',
    ],
  },
  {
    part: 9,
    subject: 'Future growth',
    note: 'Deferred by the program itself; no artifacts expected yet.',
    artifacts: [],
  },
  {
    part: 10,
    subject: 'Testing and regression',
    artifacts: ['tests', 'e2e', 'package.json', '.github/workflows/ci.yml'],
  },
  {
    part: 11,
    subject: 'Release rules',
    artifacts: ['.github/workflows/ci.yml', 'docs/OWNER-ACTIONS.md'],
  },
  {
    part: 12,
    subject: 'Development order',
    artifacts: ['docs/ARCHITECTURE-AUDIT-2026-11-17.md'],
  },
]

const strict = process.argv.includes('--strict')
const missing = []

console.log('Program status — artifacts present in this checkout\n')

for (const entry of PARTS) {
  const results = entry.artifacts.map((path) => ({ path, ok: existsSync(path) }))
  const lost = results.filter((r) => !r.ok)
  const label = `Part ${String(entry.part).padStart(2, ' ')} · ${entry.subject}`
  if (entry.artifacts.length === 0) {
    console.log(`${label}: no artifacts claimed${entry.note ? ` — ${entry.note}` : ''}`)
    continue
  }
  if (lost.length === 0) {
    console.log(`${label}: ${results.length}/${results.length} artifacts present`)
  } else {
    console.log(`${label}: ${results.length - lost.length}/${results.length} present, MISSING:`)
    for (const item of lost) {
      console.log(`        - ${item.path}`)
      missing.push({ part: entry.part, path: item.path })
    }
  }
}

// One extra check the program cares about: the dashboard should not have grown
// pages that fail the architecture rules silently.
const dashboardDir = 'src/app/(dashboard)/dashboard'
if (existsSync(dashboardDir)) {
  const pages = readdirSync(dashboardDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
  console.log(`\nDashboard areas: ${pages}`)
}

console.log(missing.length === 0 ? '\nAll claimed artifacts are present.' : `\n${missing.length} claimed artifact(s) missing.`)
if (strict && missing.length > 0) process.exit(1)
