/**
 * A barber's own numbers. `/dashboard/analytics` is owner-only, so a barber has no view
 * of their own work today. This decides what to show and refuses to guess: a count that
 * could not be read is null, never zero.
 */
export interface BarberNumber {
  id: string
  label: string
  value: number | null
  hint: string
}

export interface MyNumbersInput {
  finished: number | null
  upcoming: number | null
  cancelled: number | null
  noShows: number | null
  topServices: { name: string; count: number }[] | null
}

const UNREAD = 'Could not be checked.'

export function buildMyNumbers(input: MyNumbersInput): {
  numbers: BarberNumber[]
  topServices: { name: string; count: number }[]
  headline: string
  allRead: boolean
} {
  const numbers: BarberNumber[] = [
    { id: 'finished', label: 'Appointments you finished', value: input.finished, hint: 'In the last 30 days.' },
    { id: 'upcoming', label: 'Coming up', value: input.upcoming, hint: 'Still on the calendar.' },
    { id: 'cancelled', label: 'Cancelled by anyone', value: input.cancelled, hint: 'In the last 30 days.' },
    { id: 'noShows', label: 'People who did not turn up', value: input.noShows, hint: 'In the last 30 days.' },
  ].map((n) => (n.value === null ? { ...n, hint: UNREAD } : n))

  const allRead = numbers.every((n) => n.value !== null) && input.topServices !== null
  const headline = allRead
    ? 'Here is your last 30 days.'
    : 'Some of your numbers could not be read just now.'

  return { numbers, topServices: input.topServices ?? [], headline, allRead }
}
