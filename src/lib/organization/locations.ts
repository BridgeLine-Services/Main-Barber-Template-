/**
 * Location lifecycle (Priority 3, part C).
 *
 * Opening and closing a location are the two operations most likely to leave a shop in a
 * half-state, so each is a checklist with an explicit state machine and, for every step,
 * the five things an owner must be told: what it does, what it changes, who may do it,
 * whether it can be undone, and what happens if it goes wrong.
 */

export type LocationStatus = 'onboarding' | 'active' | 'closing' | 'closed'

export interface LocationTransition {
  from: LocationStatus
  to: LocationStatus
  allowed: boolean
  reason: string
}

const TRANSITIONS: Record<LocationStatus, LocationStatus[]> = {
  onboarding: ['active', 'closed'],
  active: ['closing'],
  closing: ['active', 'closed'],
  closed: [],
}

export function canTransition(from: LocationStatus, to: LocationStatus): LocationTransition {
  const allowed = TRANSITIONS[from]?.includes(to) ?? false
  return {
    from,
    to,
    allowed,
    reason: allowed
      ? `A location can move from ${from} to ${to}.`
      : `A location cannot move from ${from} to ${to}. ${from === 'closed' ? 'A closed location must be reopened as a new location.' : ''}`.trim(),
  }
}

export interface ChecklistStep {
  key: string
  title: string
  whatItDoes: string
  whatChanges: string
  whoMayDoIt: string
  canBeUndone: string
  ifSomethingGoesWrong: string
}

export const OPENING_STEPS: ChecklistStep[] = [
  {
    key: 'create-business',
    title: 'Create the shop record',
    whatItDoes: 'Adds this location as its own shop, with its own appointments, customers and staff.',
    whatChanges: 'A new shop record. No existing shop is touched.',
    whoMayDoIt: 'The organization owner.',
    canBeUndone: 'Yes, while the location is still onboarding: remove the location, then the empty shop.',
    ifSomethingGoesWrong: 'The location stays in onboarding and takes no bookings. Nothing else is affected.',
  },
  {
    key: 'brand',
    title: 'Set the brand',
    whatItDoes: 'Applies the shared logo and colours, and records anything this location may change.',
    whatChanges: 'The look of this location’s public pages only.',
    whoMayDoIt: 'A corporate administrator or the organization owner.',
    canBeUndone: 'Yes, by changing the brand again.',
    ifSomethingGoesWrong: 'The shared brand remains in place.',
  },
  {
    key: 'services',
    title: 'Choose the services and prices',
    whatItDoes: 'Copies the organization’s service list, with the standard prices.',
    whatChanges: 'This location’s service list and prices.',
    whoMayDoIt: 'A corporate administrator or the organization owner.',
    canBeUndone: 'Yes, by changing a price or hiding a service.',
    ifSomethingGoesWrong: 'The location keeps the standard list, which is always valid.',
  },
  {
    key: 'manager',
    title: 'Appoint a location manager',
    whatItDoes: 'Gives one person day-to-day control of this location.',
    whatChanges: 'Who can manage this location. No other location changes.',
    whoMayDoIt: 'The organization owner.',
    canBeUndone: 'Yes, by ending the assignment.',
    ifSomethingGoesWrong: 'The location stays in onboarding and nobody gains access.',
  },
  {
    key: 'open',
    title: 'Open the location',
    whatItDoes: 'Makes the location live and able to take bookings.',
    whatChanges: 'The location becomes active. Its public page and booking link work.',
    whoMayDoIt: 'The organization owner.',
    canBeUndone: 'Yes, by starting the closing process.',
    ifSomethingGoesWrong: 'Bookings are not accepted until the location is active, so nothing is double-booked.',
  },
]

export const CLOSING_STEPS: ChecklistStep[] = [
  {
    key: 'stop-bookings',
    title: 'Stop new bookings',
    whatItDoes: 'Stops the public booking page from accepting new appointments.',
    whatChanges: 'New bookings only. Existing appointments are untouched.',
    whoMayDoIt: 'A location manager, a corporate administrator or the organization owner.',
    canBeUndone: 'Yes, by reopening bookings while the location is closing.',
    ifSomethingGoesWrong: 'The page keeps taking bookings, which is the current behaviour, so nothing is lost.',
  },
  {
    key: 'settle',
    title: 'Settle payments and commissions',
    whatItDoes: 'Records what is still owed to staff and what is still owed by customers.',
    whatChanges: 'Payroll and commission records for this location.',
    whoMayDoIt: 'The organization owner, with the person who runs payroll.',
    canBeUndone: 'Adjustments can be corrected, but a paid record is history and is not deleted.',
    ifSomethingGoesWrong: 'The location cannot be closed until the records are settled.',
  },
  {
    key: 'export',
    title: 'Export the records',
    whatItDoes: 'Produces a copy of the location’s appointments, customers and payments.',
    whatChanges: 'Nothing. This only reads.',
    whoMayDoIt: 'The organization owner.',
    canBeUndone: 'Nothing to undo.',
    ifSomethingGoesWrong: 'The export can be run again.',
  },
  {
    key: 'close',
    title: 'Close the location',
    whatItDoes: 'Marks the location closed and removes it from organization totals.',
    whatChanges: 'The location status. Its records are kept.',
    whoMayDoIt: 'The organization owner.',
    canBeUndone: 'No. A closed location must be reopened as a new location. Its records remain readable.',
    ifSomethingGoesWrong: 'The location stays in closing, which is a safe state: it takes no new bookings and its data is intact.',
  },
]

export function checklistFor(status: LocationStatus): ChecklistStep[] {
  if (status === 'onboarding') return OPENING_STEPS
  if (status === 'closing') return CLOSING_STEPS
  return []
}
