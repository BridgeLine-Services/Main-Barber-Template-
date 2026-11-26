/**
 * Template version identity and update detection.
 *
 * The point of these tests is that support and an updating operator get an honest answer:
 * a copy that cannot be read is reported as unreadable rather than assumed current, and an
 * update is never described as safe.
 *
 * Run: npx tsx tests/template-version.test.ts
 */

import {
  assessUpdate,
  buildManifest,
  compareVersions,
  parseVersion,
  validateManifest,
  MANIFEST_VERSION,
  type TemplateManifest,
} from '../src/lib/template/version'

let passed = 0
let failed = 0
function ok(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.error(`  ❌ ${message}`); failed++ }
}

const manifest = (over: Partial<TemplateManifest> = {}): TemplateManifest => ({
  manifestVersion: MANIFEST_VERSION,
  templateVersion: '1.0.0',
  sourceCommit: 'abc1234',
  copiedAt: '2026-11-01T00:00:00.000Z',
  sourceRepository: 'BridgeLine-Services/Main-Barber-Template-',
  schemaFingerprint: 'deadbeefdeadbeef',
  ...over,
})

// --- Building ------------------------------------------------------------------
const built = buildManifest({ templateVersion: '1.2.3', sourceCommit: 'f32913573fe7', schemaFingerprint: 'abc123abc123' })
ok(built.ok === true, 'a manifest is built from a version, a commit and a schema fingerprint')
ok(built.manifest?.manifestVersion === MANIFEST_VERSION, 'the manifest records its own format version')
ok(built.manifest?.sourceRepository.includes('Main-Barber-Template'), 'the manifest records where the copy came from')
ok(/^\d{4}-\d{2}-\d{2}T/.test(built.manifest?.copiedAt ?? ''), 'the manifest records when the copy was made')

const placeholder = buildManifest({ templateVersion: '1.0.0', sourceCommit: 'HEAD', schemaFingerprint: 'abc' })
ok(placeholder.ok === false, 'a placeholder commit is refused rather than written down as evidence')
ok(placeholder.errors.some((e) => /commit hash/i.test(e)), 'the refusal explains what is wrong')

const noVersion = buildManifest({ templateVersion: '  ', sourceCommit: 'abc1234', schemaFingerprint: 'abc' })
ok(noVersion.ok === false, 'a manifest with no version is refused')

const noSchema = buildManifest({ templateVersion: '1.0.0', sourceCommit: 'abc1234', schemaFingerprint: '' })
ok(noSchema.ok === false, 'a manifest with no schema fingerprint is refused')

const noSecrets = JSON.stringify(built.manifest)
ok(!/token|secret|password|apiKey|DATABASE_URL/i.test(noSecrets), 'the manifest carries no credentials or secrets')

// --- Validation ----------------------------------------------------------------
ok(validateManifest(manifest()).length === 0, 'a good manifest validates')
ok(validateManifest(null).length === 1, 'a missing file is reported')
ok(validateManifest(manifest({ sourceCommit: 'unknown' })).some((p) => p.field === 'sourceCommit'), 'an unusable commit is reported')
ok(validateManifest(manifest({ templateVersion: '' })).some((p) => p.field === 'templateVersion'), 'a missing version is reported')
ok(validateManifest({ ...manifest(), manifestVersion: 99 }).some((p) => p.field === 'manifestVersion'), 'a future format version is reported rather than guessed at')

// --- Version parsing and comparison -------------------------------------------
ok(parseVersion('1.2.3')?.minor === 2, 'a version is parsed into parts')
ok(parseVersion('v1.2.3') === null, 'a non-semver string is not silently coerced')
ok(compareVersions('1.0.0', '1.0.1') === -1, 'a patch bump is ordered')
ok(compareVersions('1.2.0', '1.1.9') === 1, 'a minor bump outranks patches')
ok(compareVersions('2.0.0', '1.9.9') === 1, 'a major bump outranks minors')
ok(compareVersions('1.0.0', '1.0.0') === 0, 'equal versions compare equal')
ok(compareVersions('one', '1.0.0') === null, 'an unreadable version returns null rather than a guess')

// --- Update assessment --------------------------------------------------------
const current = { templateVersion: '1.1.0', sourceCommit: 'abc9999', schemaFingerprint: 'deadbeefdeadbeef' }

const same = assessUpdate(manifest({ templateVersion: '1.1.0', sourceCommit: 'abc9999' }), current)
ok(same.status === 'up-to-date', 'an identical copy is reported as up to date')
ok(same.considerations.length === 0, 'nothing to consider when nothing changed')

const behind = assessUpdate(manifest({ templateVersion: '1.0.0' }), current)
ok(behind.status === 'update-available', 'an older copy is reported as having an update')
ok(behind.considerations.some((c) => /changed files/i.test(c)), 'the report says to compare changed files first')
ok(behind.considerations.some((c) => /backup/i.test(c)), 'the report says to take a backup first')
ok(!/safe/i.test(behind.message), 'the report never calls an update safe')

const sameSchema = assessUpdate(manifest({ templateVersion: '1.0.0', schemaFingerprint: 'deadbeefdeadbeef' }), current)
ok(!sameSchema.considerations.some((c) => /migrations will be required/i.test(c)), 'no migrations are claimed when the schema is unchanged')

const schemaMoved = assessUpdate(manifest({ templateVersion: '1.0.0', schemaFingerprint: '0000000000000000' }), current)
ok(schemaMoved.considerations.some((c) => /migrations will be required/i.test(c)), 'migrations are flagged when the schema fingerprint differs')

const ahead = assessUpdate(manifest({ templateVersion: '2.0.0' }), current)
ok(ahead.status === 'ahead', 'a newer client copy is reported as ahead, not as needing an overwrite')
ok(ahead.considerations.some((c) => /do not overwrite/i.test(c)), 'an ahead copy warns against overwriting local work')

const broken = assessUpdate(manifest({ templateVersion: 'one-point-oh' }), current)
ok(broken.status === 'unreadable', 'an unreadable version is reported as unreadable')
ok(broken.considerations.length === 0, 'no update advice is invented for an unreadable copy')

console.log(`\nTemplate version: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
