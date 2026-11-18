'use client'

import { useMemo, useState } from 'react'
import { describeStyle, styleGuideList } from '@/lib/visual-style-guide'
import { nextBrandQuestion, recommendStyle, type BrandAnswers } from '@/lib/brand-assistant'
import { VISUAL_STYLES, type VisualStyle } from '@/lib/visual-style'

/**
 * Guided start for an owner choosing how the site looks.
 *
 * It asks five plain questions, suggests one of the eight existing looks with
 * reasons, and only changes anything when the owner presses the button. That
 * change goes through the same two steps the Appearance screen uses: save as a
 * draft, then publish. Nothing here can bypass the publish gate, and nothing is
 * saved while the owner is just answering questions.
 */

type Choice = { value: string; label: string; hint?: string }

const QUESTIONS: Array<{ key: keyof BrandAnswers; question: string; help: string; choices: Choice[] }> = [
  {
    key: 'personality',
    question: 'How should the shop feel?',
    help: 'Pick the one that sounds most like you.',
    choices: [
      { value: 'premium', label: 'Premium and understated' },
      { value: 'friendly', label: 'Friendly and familiar' },
      { value: 'bold', label: 'Bold and loud' },
      { value: 'calm', label: 'Calm and simple' },
      { value: 'unexpected', label: 'A bit different from everyone else' },
    ],
  },
  {
    key: 'clientele',
    question: 'Who mostly sits in your chair?',
    help: 'There is no wrong answer, and you can change it later.',
    choices: [
      { value: 'executives', label: 'Professionals' },
      { value: 'families', label: 'Families' },
      { value: 'young', label: 'Younger clients' },
      { value: 'mixed', label: 'A real mix' },
      { value: 'regulars', label: 'Mostly regulars' },
    ],
  },
  {
    key: 'team',
    question: 'How many chairs are working?',
    help: 'Just you, or a team.',
    choices: [
      { value: 'solo', label: 'Just me' },
      { value: 'small_team', label: 'Two or three' },
      { value: 'large_team', label: 'Four or more' },
    ],
  },
  {
    key: 'pace',
    question: 'How busy should the website feel?',
    help: 'This changes how much moves on the page.',
    choices: [
      { value: 'calm', label: 'Calm and steady' },
      { value: 'balanced', label: 'Somewhere in between' },
      { value: 'energetic', label: 'Busy and energetic' },
    ],
  },
  {
    key: 'presentation',
    question: 'What should the page lead with?',
    help: 'What a new visitor should notice first.',
    choices: [
      { value: 'photos', label: 'Photos of the work' },
      { value: 'words', label: 'A few strong words' },
      { value: 'menu', label: 'The service menu and prices' },
      { value: 'people', label: 'The barber' },
    ],
  },
]

export function BrandSetupWizard({ currentStyle }: { currentStyle?: string }) {
  const [answers, setAnswers] = useState<BrandAnswers>({})
  const [chosen, setChosen] = useState<VisualStyle | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'draft' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const recommendation = useMemo(() => recommendStyle(answers), [answers])
  const guide = useMemo(() => describeStyle(currentStyle), [currentStyle])
  const catalogue = useMemo(() => styleGuideList(), [])
  const next = nextBrandQuestion(answers)
  const answering = next !== null

  const choose = (style: VisualStyle) => {
    setChosen(style)
    setState('idle')
    setMessage('')
  }

  async function apply(style: VisualStyle) {
    setState('saving')
    setMessage('')
    try {
      const save = await fetch('/api/dashboard/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteContent: { visualPreset: style } }),
      })
      const saved = await save.json().catch(() => ({}))
      if (!save.ok) {
        setState('error')
        setMessage(saved.error || 'That did not save. Nothing was changed. Please try again.')
        return
      }
      // Same second step the Appearance screen uses: the draft becomes live only
      // when publishing succeeds.
      const publish = await fetch('/api/dashboard/website-content/publish', { method: 'POST' })
      if (publish.ok) {
        setState('saved')
        setMessage('Saved and published. Your website now uses this look. Open your website to check it.')
      } else {
        setState('draft')
        setMessage('Your choice is saved but not live yet. Publish your website from the Website settings to make it live.')
      }
    } catch {
      setState('error')
      setMessage('Your connection dropped before the change was confirmed. Reload this page to see what was saved.')
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
        <h2 className="text-lg font-semibold text-foreground">Your website today</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {guide.label}: {guide.personality}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{guide.layoutSummary}.</p>
      </section>

      <section aria-labelledby="questions" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
        <h2 id="questions" className="text-lg font-semibold text-foreground">
          {answering ? 'Five quick questions' : 'Your answers'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing is saved while you answer. You will see a suggestion, and only you can apply it.
        </p>

        <ol className="mt-4 space-y-5">
          {QUESTIONS.map((question, index) => {
            const chosenValue = typeof answers[question.key] === 'string' ? String(answers[question.key]) : ''
            const isNext = next === question.key
            return (
              <li key={question.key}>
                <fieldset>
                  <legend className="text-sm font-medium text-foreground">
                    {index + 1}. {question.question}
                    {isNext && <span className="ml-2 text-xs font-normal text-[var(--dash-brand)]">Next</span>}
                  </legend>
                  <p className="mt-1 text-xs text-muted-foreground">{question.help}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {question.choices.map((choice) => {
                      const selected = chosenValue === choice.value
                      return (
                        <button
                          key={choice.value}
                          type="button"
                          onClick={() => setAnswers((prev) => ({ ...prev, [question.key]: choice.value }))}
                          aria-pressed={selected}
                          className={
                            selected
                              ? 'rounded-full border border-[var(--dash-brand)] bg-[var(--dash-brand)]/10 px-3 py-1.5 text-sm font-medium text-foreground'
                              : 'rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
                          }
                        >
                          {choice.label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-labelledby="suggestion" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
        <h2 id="suggestion" className="text-lg font-semibold text-foreground">Our suggestion</h2>
        <p className="mt-1 text-2xl font-bold text-foreground">{describeStyle(recommendation.style).label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{describeStyle(recommendation.style).personality}</p>
        <ul className="mt-3 space-y-1">
          {recommendation.reasons.map((reason) => (
            <li key={reason} className="text-sm text-muted-foreground">{reason}</li>
          ))}
        </ul>

        {recommendation.alternatives.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            Also worth a look: {recommendation.alternatives.map((s) => describeStyle(s).label).join(' and ')}.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => choose(recommendation.style)}
            className="rounded-lg bg-[var(--dash-brand)] px-4 py-2 text-sm font-medium text-white"
          >
            Use {describeStyle(recommendation.style).label}
          </button>
          {recommendation.alternatives.map((style) => (
            <button
              key={style}
              type="button"
              onClick={() => choose(style)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-foreground"
            >
              Use {describeStyle(style).label} instead
            </button>
          ))}
        </div>

        {chosen && (
          <div className="mt-4 rounded-lg border border-border p-4">
            <p className="text-sm text-foreground">
              Selected: <span className="font-semibold">{describeStyle(chosen).label}</span>. {describeStyle(chosen).bestFor}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {describeStyle(chosen).layoutSummary}. Pace: {describeStyle(chosen).pace}.
            </p>
            <button
              type="button"
              disabled={state === 'saving'}
              onClick={() => apply(chosen)}
              className="mt-3 rounded-lg bg-[var(--dash-brand)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {state === 'saving' ? 'Saving…' : 'Save and publish this look'}
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              This changes how the website looks. Your services, prices, photos and bookings are not touched.
            </p>
          </div>
        )}

        <p role="status" aria-live="polite" className="mt-3 text-sm text-muted-foreground">
          {message}
        </p>
      </section>

      <section aria-labelledby="all-looks" className="rounded-xl border border-border bg-[var(--dash-surface)]/60 p-5">
        <h2 id="all-looks" className="text-lg font-semibold text-foreground">All eight looks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You are never limited to our suggestion. Compare them here, then choose any one.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {catalogue.map((entry) => (
            <li key={entry.style} className="rounded-lg border border-border p-4">
              <p className="font-medium text-foreground">
                {entry.label}
                {entry.style === guide.style && <span className="ml-2 text-xs text-muted-foreground">in use now</span>}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{entry.personality}</p>
              <p className="mt-1 text-xs text-muted-foreground">Best for: {entry.bestFor}</p>
              <button
                type="button"
                onClick={() => choose(entry.style)}
                className="mt-2 text-sm font-medium text-[var(--dash-brand)]"
              >
                Choose {entry.label}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          {VISUAL_STYLES.length} looks are available. This page cannot create new ones, so nothing on your site can
          break for a look that does not exist.
        </p>
      </section>
    </div>
  )
}
