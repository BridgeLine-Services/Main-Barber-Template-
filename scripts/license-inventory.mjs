import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const dependencies = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies }
const packages = new Map()

for (const name of Object.keys(dependencies)) {
  try {
    const metadata = require(`${name}/package.json`)
    const license = typeof metadata.license === 'string'
      ? metadata.license
      : Array.isArray(metadata.licenses)
        ? metadata.licenses.map((item) => item.type || item).join(', ')
        : 'UNKNOWN'
    packages.set(`${name}@${metadata.version}`, { name, version: metadata.version, license })
  } catch {
    packages.set(`${name}@unresolved`, { name, version: 'unresolved', license: 'UNKNOWN' })
  }
}

const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))
const unknown = rows.filter((row) => row.license === 'UNKNOWN')
const output = [
  '# Dependency license inventory',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  'This inventory covers direct npm dependencies declared in package.json. It does not replace legal review of transitive dependency notices or the proprietary repository license.',
  '',
  '| Package | Version | License |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`),
  '',
  `Packages: ${rows.length}`,
  `Packages requiring manual license verification: ${unknown.length}`,
]

writeFileSync('dependency-license-inventory.md', `${output.join('\n')}\n`)
console.log(`Wrote dependency-license-inventory.md (${rows.length} packages; ${unknown.length} unknown licenses).`)
