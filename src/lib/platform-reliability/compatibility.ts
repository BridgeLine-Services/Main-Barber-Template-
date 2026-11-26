/**
 * Compatibility monitoring (Priority 1, part D).
 *
 * "Up to date" is not the same as "supported". This module checks the runtime, framework,
 * database and drivers against the ranges the template is actually built and tested for,
 * and it checks the combinations that break in practice (a framework that needs a newer
 * runtime than the one installed, a database driver that needs a newer database).
 *
 * Pure: the caller supplies the versions. A version it cannot parse is reported as
 * unknown, never as supported.
 */

export type CompatibilityStatus = 'supported' | 'unsupported' | 'unknown'

export interface ComponentRule {
  component: string
  label: string
  /** Inclusive minimum major version. */
  minMajor: number
  /** Inclusive maximum major version, or null when there is no upper bound. */
  maxMajor: number | null
  /** The line the template is built and tested against, e.g. "24". */
  testedLine: string
  /** Where support is documented, so the owner can check it. */
  source: string
}

export const COMPATIBILITY_RULES: ComponentRule[] = [
  { component: 'node', label: 'Node.js runtime', minMajor: 24, maxMajor: 24, testedLine: '24', source: 'Node.js release schedule' },
  { component: 'next', label: 'Next.js', minMajor: 16, maxMajor: 16, testedLine: '16', source: 'Next.js release notes' },
  { component: 'react', label: 'React', minMajor: 19, maxMajor: 19, testedLine: '19', source: 'React release notes' },
  { component: 'prisma', label: 'Database toolkit', minMajor: 6, maxMajor: 6, testedLine: '6', source: 'Prisma release notes' },
  { component: 'postgres', label: 'PostgreSQL', minMajor: 15, maxMajor: 17, testedLine: '15-17', source: 'PostgreSQL versioning policy' },
  { component: 'pg', label: 'PostgreSQL driver', minMajor: 8, maxMajor: 8, testedLine: '8', source: 'node-postgres releases' },
]

export interface CompatibilityFinding {
  component: string
  label: string
  installed: string | null
  source: string
  status: CompatibilityStatus
  headline: string
  detail: string
  action: string | null
}

/** Extract the leading major version from forms such as "^16.4.6", ">=24.1.0", "24". */
export function majorOf(version: string | null | undefined): number | null {
  if (!version) return null
  const match = /(\d+)/.exec(version.trim())
  if (!match) return null
  const major = Number(match[1])
  return Number.isFinite(major) ? major : null
}

export function checkComponent(rule: ComponentRule, installed: string | null | undefined): CompatibilityFinding {
  const major = majorOf(installed)
  if (major === null) {
    return {
      component: rule.component,
      label: rule.label,
      installed: installed ?? null,
      source: rule.source,
      status: 'unknown',
      headline: `We could not read the ${rule.label} version.`,
      detail: 'Without the version there is no way to say whether it is supported.',
      action: `Check the ${rule.label} version in your deployment settings.`,
    }
  }
  const tooLow = major < rule.minMajor
  const tooHigh = rule.maxMajor !== null && major > rule.maxMajor
  if (tooLow || tooHigh) {
    return {
      component: rule.component,
      label: rule.label,
      installed: installed ?? null,
      source: rule.source,
      status: 'unsupported',
      headline: `${rule.label} ${installed} is outside the version this template is tested with.`,
      detail: `The template is built and tested with ${rule.label} ${rule.testedLine}. Running outside that line is not covered by the test suite.`,
      action: `Move ${rule.label} to version ${rule.testedLine} at an approved maintenance window.`,
    }
  }
  return {
    component: rule.component,
    label: rule.label,
    installed: installed ?? null,
    source: rule.source,
    status: 'supported',
    headline: `${rule.label} ${installed} is a supported version.`,
    detail: `It is inside the line this template is tested with (${rule.testedLine}).`,
    action: null,
  }
}

/** A combination that is known to break even when each part looks individually fine. */
/**
 * The true/false/null flag the dependency monitor expects, decided by the rules above.
 *
 * null means "we cannot say", which the monitor renders as Unable to verify. A component with
 * no rule is also null: guessing a support status is worse than admitting we have no rule.
 */
export function supportedFlag(component: string, installed: string | null | undefined): boolean | null {
  const rule = COMPATIBILITY_RULES.find((candidate) => candidate.component === component)
  if (!rule) return null
  const status = checkComponent(rule, installed).status
  if (status === 'supported') return true
  if (status === 'unsupported') return false
  return null
}

export interface CombinationRule {
  id: string
  requires: string
  requiresMajorAtLeast: number
  whenComponent: string
  whenMajorBelow: number
  message: string
}

export const COMBINATION_RULES: CombinationRule[] = [
  {
    id: 'next-needs-modern-node',
    requires: 'Next.js 16',
    requiresMajorAtLeast: 16,
    whenComponent: 'node',
    whenMajorBelow: 20,
    message: 'Next.js 16 needs Node.js 20.9 or newer. An older runtime fails at build and at request time.',
  },
  {
    id: 'next-needs-react-19',
    requires: 'Next.js 16',
    requiresMajorAtLeast: 16,
    whenComponent: 'react',
    whenMajorBelow: 19,
    message: 'Next.js 16 needs React 19. An older React causes hydration and rendering failures.',
  },
  {
    id: 'prisma-needs-modern-node',
    requires: 'the database toolkit 6',
    requiresMajorAtLeast: 6,
    whenComponent: 'node',
    whenMajorBelow: 18,
    message: 'The database toolkit needs Node.js 18.18 or newer. An older runtime fails when it loads.',
  },
]

export interface CombinationFinding {
  id: string
  broken: boolean
  message: string
}

export function checkCombinations(versions: Record<string, string | null | undefined>): CombinationFinding[] {
  const findings: CombinationFinding[] = []
  for (const rule of COMBINATION_RULES) {
    const triggerMajor = majorOf(versions[rule.whenComponent])
    const requiredMajor = majorOf(versions[rule.requires.split(' ').pop() ?? ''])
    // The rule only applies when the "requires" side is actually installed at that line.
    const requiresMajor = rule.requiresMajorAtLeast
    const requiresName = rule.requires.split(' ')[0].toLowerCase()
    const installedRequires = majorOf(versions[requiresName === 'next.js' ? 'next' : requiresName === 'prisma' ? 'prisma' : requiresName])
    if (installedRequires === null || installedRequires < requiresMajor) continue
    if (requiredMajor !== null && requiredMajor !== installedRequires) continue
    const broken = triggerMajor !== null && triggerMajor < rule.whenMajorBelow
    findings.push({ id: rule.id, broken, message: rule.message })
  }
  return findings
}

export interface CompatibilityReport {
  state: 'supported' | 'unsupported' | 'unknown'
  headline: string
  detail: string
  findings: CompatibilityFinding[]
  combinations: CombinationFinding[]
  unsupportedCount: number
  unknownCount: number
}

export function compatibilityReport(versions: Record<string, string | null | undefined>): CompatibilityReport {
  const findings = COMPATIBILITY_RULES.map((rule) => checkComponent(rule, versions[rule.component]))
  const combinations = checkCombinations(versions)
  const unsupportedCount = findings.filter((f) => f.status === 'unsupported').length
  const unknownCount = findings.filter((f) => f.status === 'unknown').length
  const brokenCombos = combinations.filter((c) => c.broken).length

  if (unsupportedCount > 0 || brokenCombos > 0) {
    return {
      state: 'unsupported',
      headline: 'Some of your software is outside the version this template is tested with.',
      detail: `${unsupportedCount} component${unsupportedCount === 1 ? '' : 's'} and ${brokenCombos} combination${brokenCombos === 1 ? '' : 's'} need attention before the next update.`,
      findings,
      combinations,
      unsupportedCount,
      unknownCount,
    }
  }
  if (unknownCount > 0) {
    return {
      state: 'unknown',
      headline: 'We could not read every version, so support cannot be confirmed.',
      detail: `${unknownCount} component${unknownCount === 1 ? '' : 's'} could not be checked. This is not a clean result.`,
      findings,
      combinations,
      unsupportedCount,
      unknownCount,
    }
  }
  return {
    state: 'supported',
    headline: 'Every component is inside the version this template is tested with.',
    detail: 'Runtime, framework, database and driver all match the tested line.',
    findings,
    combinations,
    unsupportedCount,
    unknownCount,
  }
}
