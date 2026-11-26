#!/usr/bin/env node
/**
 * Choose which cron plan vercel.json describes.
 *
 *   node scripts/cron-plan.mjs --check     verify vercel.json matches the selected plan
 *   node scripts/cron-plan.mjs pro         write the Pro plan (15-minute report job)
 *   node scripts/cron-plan.mjs hobby       write the Hobby plan (no sub-daily schedules)
 *
 * The report schedule is never invented here. The Pro file is the canonical record of the
 * 15-minute schedule, and switching plans is a deliberate command that shows up in a diff.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const PLANS = {
  pro: 'config/vercel/crons.pro.json',
  hobby: 'config/vercel/crons.hobby.json',
}
const VERCEL = 'vercel.json'

const command = process.argv[2] ?? '--check'
// Default to the plan the deployment actually ships. Hobby is the current Vercel plan, and a
// Hobby deployment whose vercel.json carries a sub-daily schedule is rejected at deploy time,
// so the safe default is the one that deploys. Pro is a deliberate, reviewable command.
const selected = (process.env.CRON_PLAN?.trim() || 'hobby').toLowerCase()

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

if (command === '--check') {
  const planPath = PLANS[selected]
  if (!planPath) {
    console.error(`Unknown CRON_PLAN "${selected}". Use pro or hobby.`)
    process.exit(1)
  }
  const plan = read(planPath)
  const current = read(VERCEL).crons ?? []
  if (JSON.stringify(current) !== JSON.stringify(plan)) {
    console.error(
      `vercel.json crons do not match ${planPath}. Run "npm run cron:plan:${selected}" to apply it, or fix the plan file.`,
    )
    process.exit(1)
  }
  console.log(`Cron plan matches ${selected} (${plan.length} schedules).`)
  process.exit(0)
}

if (!PLANS[command]) {
  console.error('Usage: node scripts/cron-plan.mjs [--check|pro|hobby]')
  process.exit(1)
}

const plan = read(PLANS[command])
const config = read(VERCEL)
config.crons = plan
writeFileSync(VERCEL, JSON.stringify(config, null, 2) + '\n')
console.log(`vercel.json now uses the ${command} cron plan (${plan.length} schedules).`)
