/**
 * Birthdays, kept small on purpose (Section 11 of the platform brief).
 *
 * A birthday greeting needs a month and a day. It does not need a year, so the schema never
 * stores one: the record cannot become a full date of birth by accident. Everything here is
 * pure, takes the shop-local date from the caller, and treats a missing birthday as unknown
 * rather than as the first of January.
 */

export interface Birthday {
  month: number
  day: number
}

export interface ShopDate {
  year: number
  month: number
  day: number
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

/** Month and day only. 29 February is allowed; it is a real birthday. */
export function validateBirthday(month: unknown, day: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(m) || m < 1 || m > 12) errors.push('Choose a month between January and December.')
  if (!Number.isInteger(d) || d < 1 || d > 31) errors.push('Choose a day between 1 and 31.')
  if (errors.length === 0 && d > daysInMonth(2000, m)) {
    // 2000 is a leap year, so 29 February is accepted here and everywhere else.
    errors.push(`${MONTH_NAMES[m - 1]} does not have ${d} days.`)
  }
  return { valid: errors.length === 0, errors }
}

/** Accepts "03-04", "3/4" or "March 4" and refuses anything it cannot read exactly. */
export function parseBirthdayText(text: string | null | undefined): Birthday | null {
  if (!text) return null
  const trimmed = text.trim()
  const numeric = trimmed.match(/^(\d{1,2})\s*[-/]\s*(\d{1,2})$/)
  if (numeric) {
    const month = Number(numeric[1])
    const day = Number(numeric[2])
    return validateBirthday(month, day).valid ? { month, day } : null
  }
  const named = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2})$/)
  if (named) {
    const monthWord = named[1] ?? ''
    const month = MONTH_NAMES.findIndex((name) => name.toLowerCase() === monthWord.toLowerCase()) + 1
    const day = Number(named[2])
    return month > 0 && validateBirthday(month, day).valid ? { month, day } : null
  }
  return null
}

export function formatBirthday(birthday: Birthday | null | undefined): string {
  if (!birthday) return 'Not recorded'
  return `${MONTH_NAMES[birthday.month - 1]} ${birthday.day}`
}

/**
 * The day a birthday falls on in a given year. 29 February exists only in leap years, so in
 * other years it is marked on 1 March: a greeting that never arrives is worse than one a day
 * late, and silently skipping it would look like a bug to the customer.
 */
export function birthdayInYear(birthday: Birthday, year: number): { month: number; day: number } {
  if (birthday.month === 2 && birthday.day === 29 && !isLeapYear(year)) return { month: 3, day: 1 }
  return { month: birthday.month, day: birthday.day }
}

function toUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/** Whole days from the shop's today to the next time this birthday comes round. */
export function daysUntilBirthday(birthday: Birthday, today: ShopDate): number {
  const thisYear = birthdayInYear(birthday, today.year)
  const start = toUtcDate(today.year, today.month, today.day)
  let next = toUtcDate(today.year, thisYear.month, thisYear.day)
  if (next.getTime() < start.getTime()) {
    const nextYear = birthdayInYear(birthday, today.year + 1)
    next = toUtcDate(today.year + 1, nextYear.month, nextYear.day)
  }
  return Math.round((next.getTime() - start.getTime()) / 86400000)
}

export type BirthdayAudience = 'BIRTHDAY_TODAY' | 'BIRTHDAY_WEEK' | 'BIRTHDAY_MONTH'

/** Whether a birthday belongs in one of the three audiences the campaign builder offers. */
export function matchesBirthdayAudience(
  audience: BirthdayAudience,
  birthday: Birthday | null | undefined,
  today: ShopDate,
): boolean {
  if (!birthday) return false
  const days = daysUntilBirthday(birthday, today)
  if (audience === 'BIRTHDAY_TODAY') return days === 0
  if (audience === 'BIRTHDAY_WEEK') return days <= 6
  const thisYear = birthdayInYear(birthday, today.year)
  return thisYear.month === today.month
}

export function describeBirthdayAudience(audience: BirthdayAudience): string {
  if (audience === 'BIRTHDAY_TODAY') return 'Birthday is today.'
  if (audience === 'BIRTHDAY_WEEK') return 'Birthday is in the next seven days.'
  return 'Birthday is this month.'
}
