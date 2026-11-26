#!/usr/bin/env node
/**
 * Template version identity and the update check (Part 8.1 and 8.2).
 *
 *   npm run template:version          show what this copy is running
 *   npm run template:stamp            record the current commit in TEMPLATE-VERSION.json
 *   npm run template:check            compare this copy with the upstream template
 *
 * `check` reads the upstream TEMPLATE-VERSION.json, asks GitHub which files changed
 * between the two release commits, and prints a classified proposal. It writes nothing,
 * applies nothing and never touches the database. If the network or the repository is
 * unavailable it says so and exits non-zero, because "could not check" is not "up to date".
 *
 * Environment:
 *   TEMPLATE_UPSTREAM_REPO   default BridgeLine-Services/Main-Barber-Template-
 *   GITHUB_TOKEN             optional, needed for a private upstream repository
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { assessUpdate, type ChangedFile, type VersionStamp } from '../src/lib/template-updates'

const ROOT = join(__dirname, '..')
const VERSION_FILE = join(ROOT, 'TEMPLATE-VERSION.json')
const UPSTREAM = process.env.TEMPLATE_UPSTREAM_REPO ?? 'BridgeLine-Services/Main-Barber-Template-'

function readLocal(): VersionStamp & Record<string, unknown> {
  return JSON.parse(readFileSync(VERSION_FILE, 'utf8'))
}

function commandShow() {
  const local = readLocal()
  console.log(`${local.template} ${local.version}`)
  console.log(`Released:      ${local.releasedAt}`)
  console.log(`Release commit: ${local.sourceCommit ?? 'not stamped (run npm run template:stamp)'}`)
  console.log(`App version:   ${local.compatibleAppVersion}`)
  console.log(`Needs Node.js: ${local.requiredNodeMajor} or newer`)
  console.log(`Migrations:    ${local.schemaMigrationCount}`)
  console.log(`Notes:         ${local.notes}`)
}

function commandStamp() {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim()
  const local = readLocal()
  local.sourceCommit = commit
  writeFileSync(VERSION_FILE, JSON.stringify(local, null, 2) + '\n')
  console.log(`Stamped ${local.version} at ${commit}.`)
}

async function github(path: string, token?: string): Promise<Response> {
  return fetch(`https://api.github.com/${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'main-barber-template-update-check',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
}

async function commandCheck() {
  const local = readLocal()
  const token = process.env.GITHUB_TOKEN

  console.log(`This copy: ${local.version}${local.sourceCommit ? ` (${String(local.sourceCommit).slice(0, 7)})` : ' (release commit not stamped)'}`)
  console.log(`Upstream:  ${UPSTREAM}`)

  let remote: (VersionStamp & Record<string, unknown>) | null = null
  try {
    const res = await github(`repos/${UPSTREAM}/contents/TEMPLATE-VERSION.json`, token)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { content?: string }
    remote = JSON.parse(Buffer.from(body.content ?? '', 'base64').toString('utf8'))
    console.log(`Upstream version: ${remote?.version}`)
  } catch (error) {
    console.error(`Could not check for updates: ${(error as Error).message}. Nothing was changed.`)
    process.exit(2)
  }

  if (!local.sourceCommit || !remote?.sourceCommit) {
    console.log('')
    console.log('Both copies need a stamped release commit before file-level changes can be compared.')
    console.log('A version number alone is not enough to say what changed, so no proposal is made.')
    if (remote && remote.version !== local.version) {
      console.log(`Versions differ (${local.version} → ${remote.version}). Read the upstream release notes before planning anything.`)
    }
    return
  }

  if (local.version === remote.version && local.sourceCommit === remote.sourceCommit) {
    console.log('')
    console.log(assessUpdate(local, remote, []).summary)
    return
  }

  let files: ChangedFile[] = []
  try {
    const res = await github(`repos/${UPSTREAM}/compare/${local.sourceCommit}...${remote.sourceCommit}`, token)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = (await res.json()) as { files?: Array<{ filename: string; status: string }> }
    files = (body.files ?? []).map((f) => ({
      path: f.filename,
      status: f.status === 'added' ? 'added' : f.status === 'removed' ? 'removed' : 'modified',
    }))
  } catch (error) {
    console.error(`Could not read the changed files: ${(error as Error).message}. Nothing was changed.`)
    process.exit(2)
  }

  const assessment = assessUpdate(local, remote, files)
  console.log('')
  console.log(assessment.summary)
  console.log('')
  console.log(`Changed: ${assessment.counts.total} (${assessment.counts.added} added, ${assessment.counts.modified} modified, ${assessment.counts.removed} removed)`)
  console.log(`Risk:    ${assessment.risk}`)
  if (assessment.migrations.length > 0) console.log(`Migrations (never automatic): ${assessment.migrations.join(', ')}`)
  if (assessment.security.length > 0) console.log(`Security files: ${assessment.security.join(', ')}`)
  if (assessment.dependencies) console.log('Dependencies: package files changed')
  if (assessment.conflicts.length > 0) console.log(`Yours to merge by hand: ${assessment.conflicts.join(', ')}`)
  console.log('')
  assessment.steps.forEach((step, index) => console.log(`${index + 1}. ${step}`))
  console.log('')
  console.log('Nothing was applied. This report is a proposal.')
}

async function main() {
  const command = process.argv[2] ?? 'version'
  if (command === 'version' || command === 'show') return commandShow()
  if (command === 'stamp') return commandStamp()
  if (command === 'check') return commandCheck()
  console.error(`Unknown command: ${command}. Use version, stamp or check.`)
  process.exit(1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
