/**
 * Website version history (Section 8.2 and 8.3).
 *
 * The rules that matter: versions count up and are never reused, a restore writes only the
 * draft, and a stored snapshot can never put ids, timestamps or another shop's fields back
 * into the record.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PUBLISH_FIELDS,
  buildVersionEntry,
  changedFields,
  cleanSummary,
  describeSnapshotChange,
  describeVersion,
  nextVersionNumber,
  snapshotToDraftPatch,
} from '../src/lib/website-versions'

let p = 0
const f: string[] = []
const ok = (n: string, c: boolean, d = '') => { if (c) p++; else f.push(n + (d ? ' — ' + d : '')) }

const root = process.cwd()

// --- numbers ---
ok('an empty history starts at one', nextVersionNumber([]) === 1)
ok('the next number follows the highest', nextVersionNumber([1, 2, 3]) === 4)
ok('order does not matter', nextVersionNumber([3, 1]) === 4)
ok('a gap is not reused', nextVersionNumber([1, 5]) === 6)
ok('rubbish values are ignored', nextVersionNumber([Number.NaN, 2.7]) === 3)
ok('a stored number is floored', buildVersionEntry({ businessId: 'b', version: 2.9, snapshot: {}, publishedAt: '2026-11-26T09:00:00Z' }).version === 2)
ok('version zero is raised to one', buildVersionEntry({ businessId: 'b', version: 0, snapshot: {}, publishedAt: '2026-11-26T09:00:00Z' }).version === 1)

// --- summaries ---
ok('no summary is null', cleanSummary(undefined) === null && cleanSummary(null) === null)
ok('whitespace is not a summary', cleanSummary('   ') === null)
ok('whitespace is collapsed', cleanSummary('  hero\n\n changed  ') === 'hero changed')
ok('a summary is bounded', (cleanSummary('x'.repeat(500)) ?? '').length === 200)
ok('the author is kept', buildVersionEntry({ businessId: 'b', version: 1, snapshot: {}, authorId: 'u1', publishedAt: '2026-11-26T09:00:00Z' }).authorId === 'u1')
ok('no author is null', buildVersionEntry({ businessId: 'b', version: 1, snapshot: {}, publishedAt: '2026-11-26T09:00:00Z' }).authorId === null)

// --- what changed ---
const before = { heroTitle: 'Old', visualPreset: 'street-cut' }
const after = { heroTitle: 'New', visualPreset: 'street-cut' }
ok('one change is found', changedFields(before, after).join(',') === 'heroTitle')
ok('no change is found', changedFields(after, { ...after }).length === 0)
ok('a first publish describes itself', describeSnapshotChange(null, after) === 'First published version.')
ok('an identical publish says so', describeSnapshotChange(after, { ...after }) === 'Published with no visible change.')
ok('one change reads naturally', describeSnapshotChange(before, after) === 'Changed the hero title.')
ok('two changes read naturally', describeSnapshotChange({}, { heroTitle: 'x', visualPreset: 'y' }) === 'Changed the hero title and visual preset.')
const many = describeSnapshotChange({}, { heroTitle: 'a', heroDescription: 'b', visualPreset: 'c', homeModules: [] })
ok('many changes are counted', many.startsWith('Changed 4 things, including the hero title and the hero description'), many)
ok('the diff never invents a field', changedFields({ heroTitle: 'x' }, {}).join(',') === 'heroTitle')

// --- restoring is draft-only and field-limited ---
const patch = snapshotToDraftPatch({ heroTitle: 'Back', businessId: 'other', id: 'x', createdAt: 'now', notAField: 1 })
ok('known fields are copied', patch.heroTitle === 'Back')
ok('a foreign businessId is not copied', !('businessId' in patch))
ok('an id is not copied', !('id' in patch))
ok('a timestamp is not copied', !('createdAt' in patch))
ok('an unknown field is not copied', !('notAField' in patch))
ok('null and arrays restore nothing', Object.keys(snapshotToDraftPatch(null)).length === 0 && Object.keys(snapshotToDraftPatch([1, 2])).length === 0)
ok('navigation is part of a version', (PUBLISH_FIELDS as readonly string[]).includes('navigation'))

// --- the label ---
const label = describeVersion({ version: 3, publishedAt: '2026-11-26T09:00:00Z', summary: 'Changed the hero title.' })
ok('the label names the version', label.startsWith('Version 3, published 2026-11-26 09:00 UTC.'), label)
ok('the label carries the summary', label.endsWith('Changed the hero title.'))
ok('an unreadable date is admitted', /unknown date/.test(describeVersion({ version: 1, publishedAt: 'not-a-date', summary: null })))

// --- the server boundary ---
const publishRoute = readFileSync(join(root, 'src/app/api/dashboard/website-content/publish/route.ts'), 'utf8')
const listRoute = readFileSync(join(root, 'src/app/api/dashboard/website-content/versions/route.ts'), 'utf8')
const restoreRoute = readFileSync(join(root, 'src/app/api/dashboard/website-content/versions/[id]/restore/route.ts'), 'utf8')
const component = readFileSync(join(root, 'src/components/dashboard/WebsiteVersionHistory.tsx'), 'utf8')

ok('publishing records a version', /websiteContentVersion\.create/.test(publishRoute))
ok('the snapshot and its version share a transaction', /prisma\.\$transaction/.test(publishRoute))
ok('one field list, not two', /from '@\/lib\/website-versions'/.test(publishRoute) && !/const PUBLISH_FIELDS = \[/.test(publishRoute))
ok('the list is scoped to the session business', /where: \{ businessId \}/.test(listRoute))
ok('the list never takes a businessId from the request', !/searchParams/.test(listRoute))
ok('restoring is owner only', /role !== 'OWNER'/.test(restoreRoute))
ok('restoring looks the version up inside the business', /findFirst\(\{\s*\n?\s*where: \{ id, businessId \}/.test(restoreRoute))
ok('restoring never writes the published snapshot', !/publishedContent/.test(restoreRoute))
ok('restoring is audited', /logAudit/.test(restoreRoute))
ok('restoring says the live site is unchanged', /live site is unchanged/.test(restoreRoute))
ok('the screen confirms before restoring', /confirming === row\.id/.test(component))
ok('the screen announces the result', /aria-live="polite"/.test(component))
ok('the screen reports errors as alerts', /role="alert"/.test(component))
ok('the screen uses a full-height touch target', /min-h-11/.test(component))
ok('the screen never restores on first click', /setConfirming\(row\.id\)/.test(component))

console.log(`\nWebsite version history: ${p} passed, ${f.length} failed`)
if (f.length) { for (const line of f) console.log('  FAIL', line); process.exit(1) }
