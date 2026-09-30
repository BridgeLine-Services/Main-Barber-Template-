// ============================================================================
// Advanced Schedule System
// Supports complex scheduling rules: buffer times, lunch breaks,
// concurrent appointment limits, and preparation/cleanup time per service
// ============================================================================

import { prisma } from '@/lib/prisma'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ScheduleConfig {
  bufferTimeBefore: number // minutes before appointment (prep)
  bufferTimeAfter: number  // minutes after appointment (cleanup)
  maxConcurrentPerBarber: number
  lunchBreakStart: string // "12:00"
  lunchBreakEnd: string   // "13:00"
  lunchBreakEnabled: boolean
  slotInterval: number // minutes between available slots (15, 30, etc.)
  allowDoubleBooking: boolean
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  bufferTimeBefore: 0,
  bufferTimeAfter: 5,
  maxConcurrentPerBarber: 1,
  lunchBreakStart: '12:00',
  lunchBreakEnd: '13:00',
  lunchBreakEnabled: true,
  slotInterval: 15,
  allowDoubleBooking: false,
}

// ─── Functions ───────────────────────────────────────────────────────────────

export async function getScheduleConfig(businessId: string): Promise<ScheduleConfig> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { hours: true },
  })
  if (!business?.hours) return DEFAULT_SCHEDULE_CONFIG
  const hours = business.hours as { scheduleConfig?: Partial<ScheduleConfig> } | null
  return { ...DEFAULT_SCHEDULE_CONFIG, ...hours.scheduleConfig }
}

export async function updateScheduleConfig(
  businessId: string,
  config: Partial<ScheduleConfig>
): Promise<ScheduleConfig> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { hours: true },
  })
  const currentHours = (business?.hours as { scheduleConfig?: Partial<ScheduleConfig> } | null) || {}
  const currentConfig = { ...DEFAULT_SCHEDULE_CONFIG, ...currentHours.scheduleConfig }
  const newConfig = { ...currentConfig, ...config }
  const updatedHours = { ...currentHours, scheduleConfig: newConfig }
  await prisma.business.update({
    where: { id: businessId },
    data: { hours: updatedHours },
  })
  return newConfig
}

export function getEffectiveDuration(serviceDuration: number, config: ScheduleConfig): number {
  return serviceDuration + config.bufferTimeBefore + config.bufferTimeAfter
}

export function isDuringLunchBreak(startTime: Date, endTime: Date, config: ScheduleConfig): boolean {
  if (!config.lunchBreakEnabled) return false
  const slotStart = startTime.getHours() * 60 + startTime.getMinutes()
  const slotEnd = endTime.getHours() * 60 + endTime.getMinutes()
  const [lh, lm] = config.lunchBreakStart.split(':').map(Number)
  const [eh, em] = config.lunchBreakEnd.split(':').map(Number)
  const lunchStart = lh * 60 + lm
  const lunchEnd = eh * 60 + em
  return slotStart < lunchEnd && slotEnd > lunchStart
}

export function generateSlotStartTimes(
  dayOpen: string,
  dayClose: string,
  config: ScheduleConfig,
  serviceDuration: number
): string[] {
  const [openHour, openMin] = dayOpen.split(':').map(Number)
  const [closeHour, closeMin] = dayClose.split(':').map(Number)
  const openMinutes = openHour * 60 + openMin
  const closeMinutes = closeHour * 60 + closeMin
  const effectiveDuration = getEffectiveDuration(serviceDuration, config)
  const slots: string[] = []
  for (let t = openMinutes; t + effectiveDuration <= closeMinutes; t += config.slotInterval) {
    const hour = Math.floor(t / 60)
    const min = t % 60
    slots.push(`${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`)
  }
  return slots
}

export function validateAgainstScheduleRules(
  startTime: Date,
  endTime: Date,
  config: ScheduleConfig
): { valid: boolean; reason?: string } {
  if (isDuringLunchBreak(startTime, endTime, config)) {
    return { valid: false, reason: 'This time overlaps with the lunch break.' }
  }
  return { valid: true }
}
