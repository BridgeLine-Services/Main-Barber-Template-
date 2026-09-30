// Shared type for the Business.hours JSON column:
// { monday: { open: "09:00", close: "18:00", isOff: false }, ... }
export interface DayHours {
  open: string
  close: string
  isOff: boolean
}

export type BusinessHours = Record<string, DayHours>

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  monday: { open: '09:00', close: '18:00', isOff: false },
  tuesday: { open: '09:00', close: '18:00', isOff: false },
  wednesday: { open: '09:00', close: '18:00', isOff: false },
  thursday: { open: '09:00', close: '18:00', isOff: false },
  friday: { open: '09:00', close: '18:00', isOff: false },
  saturday: { open: '09:00', close: '17:00', isOff: false },
  sunday: { open: '09:00', close: '17:00', isOff: true },
}
