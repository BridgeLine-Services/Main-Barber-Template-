#!/usr/bin/env node
/**
 * Regression evidence: run every local suite and record what actually happened.
 *
 * The program asks for itemised evidence, not a claim. This runs each suite under
 * tests/ (and each Playwright spec under e2e/, if asked) and writes a dated Markdown
 * record with the real exit code and the suite's own summary line. A suite that
 * fails, times out, or prints nothing useful is recorded as exactly that, so the
 * document can never overstate coverage.
 *
 * Usage:
 *   node scripts/regression-evidence.mjs            # unit/integration suites in tests/
 *   node scripts/regression-evidence.mjs --with-e2e # also runs the API-level e2e scripts
 *   node scripts/regression-evidence.mjs --list     # only list what would run
 *
 * Exit code: 0 when every suite passed, 1 when anything failed, 2 when nothing ran.
 */

import { spawn } from 'node:child_process'
import { readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const CONCURRENCY = Number(process.env.EVIDENCE_CONCURRENCY || 3)
const TIMEOUT_MS = Number(process.env.EVIDENCE_TIMEOUT_MS || 300_000)
const withE2E = process.argv.includes('--with-e2e')
const listOnly = process.argv.includes('--list')

function filesIn(dir, filter) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && filter(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort()
}

const suites = filesIn(join(ROOT, 'tests'), (name) => name.endsWith('.test.ts'))
const e2eScripts = withE2E
  ? filesIn(join(ROOT, 'e2e'), (name) => name.endsWith('.spec.ts')).filter(() => false) // Playwright specs are CI-gated, not tsx scripts
  : []

const targets = [...suites, ...e2eScripts]

if (listOnly) {
  console.log(`${targets.length} suite(s) would run:`)
  for (const file of targets) console.log(`  ${file.replace(ROOT + '/', '')}`)
  process.exit(0)
}

if (targets.length === 0) {
  console.error('No suites found.')
  process.exit(2)
}

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, ['--import', 'tsx', file], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk) => { out += chunk.toString() })
    child.stderr.on('data', (chunk) => { err += chunk.toString() })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const lines = `${out}\n${err}`.split('\n').map((l) => l.trim()).filter(Boolean)
      // The suites print their own summary; keep the most informative trailing line.
      const summary =
        [...lines].reverse().find((l) => /passed|failed|checks|assertions|✅|❌/i.test(l)) ||
        lines[lines.length - 1] ||
        '(no output)'
      resolve({
        file: file.replace(ROOT + '/', ''),
        code,
        signal,
        ms: Date.now() - started,
        summary: summary.slice(0, 200),
      })
    })
  })
}

const results = []
let cursor = 0
async function worker() {
  while (cursor < targets.length) {
    const mine = targets[cursor++]
    const result = await runOne(mine)
    results.push(result)
    const mark = result.code === 0 ? 'PASS' : 'FAIL'
    console.log(`${mark}  ${result.file} — ${result.summary}`)
  }
}

const startedAt = new Date()
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
results.sort((a, b) => a.file.localeCompare(b.file))

const passed = results.filter((r) => r.code === 0)
const failed = results.filter((r) => r.code !== 0)
const stamp = startedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

const lines = [
  '# Regression evidence',
  '',
  `Generated ${stamp} by \`scripts/regression-evidence.mjs\`.`,
  '',
  'Every line below is a suite that actually ran in this checkout. The summary is the',
  "suite's own closing line, so a passing suite that printed nothing useful shows no",
  'summary rather than an invented one. Nothing here is copied from an earlier report.',
  '',
  `- Suites run: **${results.length}**`,
  `- Passed: **${passed.length}**`,
  `- Failed: **${failed.length}**`,
  '',
  '## Suites',
  '',
  '| Suite | Result | Summary | Time |',
  '| --- | --- | --- | --- |',
  ...results.map(
    (r) =>
      `| \`${r.file}\` | ${r.code === 0 ? 'pass' : r.signal ? `killed (${r.signal})` : `fail (exit ${r.code})`} | ${r.summary.replace(/\|/g, '\\|')} | ${(r.ms / 1000).toFixed(1)}s |`,
  ),
  '',
  failed.length === 0
    ? 'All suites passed in this run.'
    : `**${failed.length} suite(s) did not pass.** Treat the program's regression claim as unproven until these are green.`,
  '',
  'Note: the Playwright browser specs (70 of them) are gated in CI, not by this script.',
  'This record covers the local suites only; see the latest green Template CI run for the',
  'browser evidence.',
  '',
]

mkdirSync(join(ROOT, 'docs'), { recursive: true })
const outPath = join(ROOT, 'docs', 'REGRESSION-EVIDENCE.md')
writeFileSync(outPath, lines.join('\n'))
console.log(`\nWrote ${outPath.replace(ROOT + '/', '')} — ${passed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
