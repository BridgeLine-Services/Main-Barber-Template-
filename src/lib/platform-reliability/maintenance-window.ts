/**
 * When a repair may run (Part 5.5).
 *
 * The directive is specific: routine maintenance must not interrupt bookings or a customer
 * standing at the counter. This decides, from the shop's own opening hours and the class of
 * the repair, whether something may run now or should wait.
 *
 * It is a recommendation, never an action. Nothing here starts a repair, and nothing here
 * can be used to justify running a migration: a database change does not become safe to
 * apply unattended because the shop is closed. It is only ever proposed, then applied by a
 * person after a backup.
 */

import type { RepairClass } from './dependency-monitor'

export type WindowDecision = 'run-now' | 'wait-for-quiet' | 'never-automatic'

export interface OpenHours {
  open?: string
  close?: string
  isOff?: boolean
}

/** The shape the Business model stores in its `hours` column. */
export type WeeklyHours = Record<string, OpenHours | undefined> | null | undefined

export interface WindowVerdict {
  decision: WindowDecision
  /** Plain English for the owner. */
  sentence: string
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

/** "09:00" → 540 minutes. Returns null rather than guessing when the value is unreadable. */
function toMinutes(value: string | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Whether the shop is open at a given local time.
 * Unknown hours return `null`, not `false`: assuming a shop is closed because we could not
 * read its hours is how a repair lands in the middle of a Saturday.
 */
export function isOpenAt(hours: WeeklyHours, localTime: Date): boolean | null {
  if (!hours) return null
  const day = DAY_KEYS[localTime.getDay()]
  const today = hours[day]
  if (!today) return null
  if (today.isOff) return false
  const open = toMinutes(today.open)
  const close = toMinutes(today.close)
  if (open === null || close === null) return null
  const now = localTime.getHours() * 60 + localTime.getMinutes()
  return now >= open && now < close
}

/**
 * The decision for one repair. Safe, reversible checks may run at any time because they do
 * not change the running system. Anything that touches the running system waits for a quiet
 * period. Anything a specialist must do is never automatic at all.
 */
export function decideWindow(
  repairClass: RepairClass,
  hours: WeeklyHours,
  localTime: Date
): WindowVerdict {
  if (repairClass === 'manual') {
    return {
      decision: 'never-automatic',
      sentence:
        'A specialist handles this one. It is not something the platform should start on its own, whenever it runs.',
    }
  }

  if (repairClass === 'automatic') {
    return {
      decision: 'run-now',
      sentence: 'This only reads and checks, so it can run while the shop is open without disturbing anyone.',
    }
  }

  const open = isOpenAt(hours, localTime)
  if (open === true) {
    return {
      decision: 'wait-for-quiet',
      sentence:
        'The shop is open, so this waits. Changing the running system now could interrupt a booking or a payment.',
    }
  }
  if (open === false) {
    return {
      decision: 'wait-for-quiet',
      sentence:
        'The shop is closed, which is a good time for this. It still needs your approval, and a backup first if it touches the database.',
    }
  }
  return {
    decision: 'wait-for-quiet',
    sentence:
      'We could not read your opening hours, so this waits rather than risk interrupting a customer. Setting your hours fixes this.',
  }
}

/** True only for work that may never be started by the platform, at any hour. */
export function isForbiddenAutomatic(repairClass: RepairClass): boolean {
  return repairClass === 'manual'
}
