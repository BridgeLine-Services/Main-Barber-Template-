/**
 * Brand colour contrast (Section 17 of the platform brief).
 *
 * The default theme passing says nothing about a shop that sets a pale gold accent on a
 * cream background. These are the WCAG contrast rules, applied to whatever colours the
 * owner picked, so an unreadable pairing is named before it reaches customers.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface ContrastFinding {
  pair: string
  foreground: string
  background: string
  /** Null when a colour could not be read, which is never reported as a pass. */
  ratio: number | null
  required: number
  passes: boolean
  advice: string
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function parseHexColor(input: string | null | undefined): Rgb | null {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!HEX.test(value)) return null
  const body = value.slice(1)
  const full = body.length === 3 ? body.split('').map((c) => c + c).join('') : body
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  }
}

function channelLuminance(channel: number): number {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

function finding(pair: string, foreground: string, background: string, minimum: number): ContrastFinding {
  const fg = parseHexColor(foreground)
  const bg = parseHexColor(background)
  if (!fg || !bg) {
    return {
      pair,
      foreground,
      background,
      ratio: null,
      required: minimum,
      passes: false,
      advice: 'One of these colours is not a six digit hex value, so contrast cannot be checked.',
    }
  }
  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100
  return {
    pair,
    foreground,
    background,
    ratio,
    required: minimum,
    passes: ratio >= minimum,
    advice:
      ratio >= minimum
        ? `Readable: ${ratio}:1, above the ${minimum}:1 minimum.`
        : `Only ${ratio}:1 against a ${minimum}:1 minimum. Darken or lighten one of these colours, or the text will be hard to read.`,
  }
}

export interface BrandColors {
  primaryColor?: string | null
  accentColor?: string | null
  secondaryColor?: string | null
}

/**
 * The three pairings a customer actually reads: white on the primary colour (headings and
 * buttons), white on the accent (badges and calls to action), and the accent used as text on
 * the primary surface.
 */
export function auditBrandContrast(colors: BrandColors): ContrastFinding[] {
  const findings: ContrastFinding[] = []
  if (colors.primaryColor) {
    findings.push(finding('White text on the primary colour', '#ffffff', colors.primaryColor, 4.5))
  }
  if (colors.accentColor) {
    findings.push(finding('White text on the accent colour', '#ffffff', colors.accentColor, 4.5))
  }
  if (colors.primaryColor && colors.accentColor) {
    findings.push(finding('Accent text on the primary colour', colors.accentColor, colors.primaryColor, 4.5))
  }
  return findings
}

export function summariseContrast(findings: ContrastFinding[]): string {
  if (findings.length === 0) return 'No brand colours set, so the default theme applies.'
  const failing = findings.filter((entry) => !entry.passes)
  if (failing.length === 0) return 'Every brand pairing meets the 4.5:1 contrast minimum.'
  return `${failing.length} of ${findings.length} brand pairings are below the 4.5:1 minimum: ${failing.map((entry) => entry.pair.toLowerCase()).join('; ')}.`
}
