/**
 * Brand setup assistant: recommends one of the eight existing identities.
 *
 * The enhancement program asks for a guided experience that helps an owner
 * choose a starting point. The hard rule is that it may only ever recommend an
 * identity that already exists, and that the owner stays in control: nothing
 * here saves, publishes or silently selects anything. It returns a suggestion
 * plus the reasons, and the caller shows it.
 *
 * Design notes:
 *   - Deterministic. Same answers always produce the same recommendation.
 *   - Exhaustive answers in, a valid `VisualStyle` out. Unknown or missing
 *     answers are ignored rather than guessed at, and a weak signal falls back
 *     to `modern-classic`, which is the documented default identity.
 *   - Never invents a new identity or a variation. Alternatives come from
 *     `VISUAL_STYLES` only.
 *
 * Pure module: no React, no database, no I/O.
 */

import { VISUAL_STYLES, type VisualStyle } from './visual-style'

/** The five questions the assistant asks, in the order it asks them. */
export const BRAND_QUESTIONS = [
  'personality',
  'clientele',
  'team',
  'pace',
  'presentation',
] as const

export type BrandQuestion = (typeof BRAND_QUESTIONS)[number]

export interface BrandAnswers {
  /** How the shop wants to feel. */
  personality?: 'premium' | 'friendly' | 'bold' | 'calm' | 'unexpected' | string
  /** Who the shop serves. */
  clientele?: 'executives' | 'families' | 'young' | 'mixed' | 'regulars' | string
  /** How many chairs. */
  team?: 'solo' | 'small_team' | 'large_team' | string
  /** How busy the website should feel. */
  pace?: 'calm' | 'balanced' | 'energetic' | string
  /** What the owner wants the site to lead with. */
  presentation?: 'photos' | 'words' | 'menu' | 'people' | string
}

export interface BrandRecommendation {
  /** Always one of the eight existing identities. */
  style: VisualStyle
  /** Plain-language reasons, safe to show an owner verbatim. */
  reasons: string[]
  /** Up to two further identities, for "not quite right? try these". */
  alternatives: VisualStyle[]
  /** True when the answers did not clearly favour anything, so the default won. */
  isDefault: boolean
}

const DEFAULT_STYLE: VisualStyle = 'modern-classic'

interface Trait {
  style: VisualStyle
  personality: string[]
  clientele: string[]
  team: string[]
  pace: string[]
  presentation: string[]
}

/**
 * Traits per identity, expressed as the same vocabulary the assistant asks in.
 * The weights are 2 for a defining trait and 1 for a supporting one.
 */
const TRAITS: Record<VisualStyle, Trait> = {
  'black-label': {
    style: 'black-label',
    personality: ['premium'],
    clientele: ['executives'],
    team: [],
    pace: ['calm'],
    presentation: ['photos', 'words'],
  },
  'barber-heritage': {
    style: 'barber-heritage',
    personality: ['friendly'],
    clientele: ['regulars', 'families'],
    team: ['small_team'],
    pace: ['balanced'],
    presentation: ['photos'],
  },
  'street-cut': {
    style: 'street-cut',
    personality: ['bold'],
    clientele: ['young'],
    team: ['small_team'],
    pace: ['energetic'],
    presentation: ['photos'],
  },
  'clean-club': {
    style: 'clean-club',
    personality: ['calm'],
    clientele: ['families', 'mixed'],
    team: ['large_team'],
    pace: ['calm'],
    presentation: ['menu'],
  },
  'modern-classic': {
    style: 'modern-classic',
    personality: ['friendly'],
    clientele: ['mixed'],
    team: ['small_team'],
    pace: ['balanced'],
    presentation: ['words'],
  },
  'warm-premium': {
    style: 'warm-premium',
    personality: ['premium', 'friendly'],
    clientele: ['executives', 'regulars'],
    team: ['small_team'],
    pace: ['calm'],
    presentation: ['photos'],
  },
  'high-energy-urban': {
    style: 'high-energy-urban',
    personality: ['bold', 'unexpected'],
    clientele: ['young'],
    team: ['small_team'],
    pace: ['energetic'],
    presentation: ['photos'],
  },
  'single-chair': {
    style: 'single-chair',
    personality: ['premium', 'unexpected'],
    clientele: ['regulars'],
    team: ['solo'],
    pace: ['balanced'],
    presentation: ['people', 'menu'],
  },
}

const SCORE_DEFINING = 2
const SCORE_SUPPORTING = 1

function normalise(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function scoreFor(trait: Trait, answers: BrandAnswers): number {
  let score = 0
  const personality = normalise(answers.personality)
  const clientele = normalise(answers.clientele)
  const team = normalise(answers.team)
  const pace = normalise(answers.pace)
  const presentation = normalise(answers.presentation)

  if (personality && trait.personality.includes(personality)) {
    score += trait.personality[0] === personality ? SCORE_DEFINING : SCORE_SUPPORTING
  }
  if (clientele && trait.clientele.includes(clientele)) {
    score += trait.clientele[0] === clientele ? SCORE_DEFINING : SCORE_SUPPORTING
  }
  if (team && trait.team.includes(team)) score += SCORE_DEFINING
  if (pace && trait.pace.includes(pace)) score += SCORE_DEFINING
  if (presentation && trait.presentation.includes(presentation)) {
    score += trait.presentation[0] === presentation ? SCORE_DEFINING : SCORE_SUPPORTING
  }
  return score
}

/** Answers that were understood, for the reasons list. Never mentions raw input. */
function describeAnswer(answers: BrandAnswers): string[] {
  const out: string[] = []
  const personality = normalise(answers.personality)
  const clientele = normalise(answers.clientele)
  const team = normalise(answers.team)
  const pace = normalise(answers.pace)

  if (['premium', 'friendly', 'bold', 'calm', 'unexpected'].includes(personality)) {
    out.push(`you want the site to feel ${personality === 'unexpected' ? 'distinctive' : personality}`)
  }
  if (['executives', 'families', 'young', 'mixed', 'regulars'].includes(clientele)) {
    out.push(`your clients are ${clientele === 'regulars' ? 'mostly regulars' : clientele}`)
  }
  if (team === 'solo') out.push('you work alone')
  if (team === 'large_team') out.push('you have a larger team')
  if (pace && ['calm', 'balanced', 'energetic'].includes(pace)) out.push(`the site should feel ${pace}`)
  return out
}

/**
 * Recommend a starting identity. Nothing is applied: the caller decides whether
 * to use it, and the owner can always pick something else.
 */
export function recommendStyle(answers: BrandAnswers = {}): BrandRecommendation {
  const safe: BrandAnswers = answers ?? {}
  const scored = VISUAL_STYLES.map((style) => ({ style, score: scoreFor(TRAITS[style], safe) }))
  const best = [...scored].sort((a, b) => b.score - a.score)[0]
  const understood = describeAnswer(safe)
  const reasons = understood.length
    ? [`This starts from a look that suits what you told us: ${understood.join(', ')}.`]
    : ['Not enough answers to judge, so this is our balanced starting point.']
  reasons.push('You can preview it with your own services and photos, and change it at any time.')

  // A weak signal means no answer matched anything defining: use the default.
  const isDefault = !best || best.score === 0
  const style: VisualStyle = isDefault ? DEFAULT_STYLE : best.style

  const alternatives = VISUAL_STYLES
    .filter((s) => s !== style)
    .map((s) => ({ style: s, score: scoreFor(TRAITS[s], safe) }))
    .sort((a, b) => b.score - a.score || VISUAL_STYLES.indexOf(a.style) - VISUAL_STYLES.indexOf(b.style))
    .slice(0, 2)
    .map((s) => s.style)

  return { style, reasons, alternatives, isDefault }
}

/** The next unanswered question, so a wizard can ask one thing at a time. */
export function nextBrandQuestion(answers: BrandAnswers = {}): BrandQuestion | null {
  return BRAND_QUESTIONS.find((q) => !normalise((answers ?? {})[q])) ?? null
}

/** True when every question has an answer. */
export function isBrandQuizComplete(answers: BrandAnswers = {}): boolean {
  return nextBrandQuestion(answers) === null
}
