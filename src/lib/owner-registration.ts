export const OWNER_REGISTRATION_MODES = ['onboarding', 'invite_only', 'disabled'] as const
export type OwnerRegistrationMode = (typeof OWNER_REGISTRATION_MODES)[number]

export function parseOwnerRegistrationMode(raw: string | null | undefined): OwnerRegistrationMode {
  const normalized = (raw ?? 'onboarding').trim().toLowerCase()
  if (normalized === 'onboarding' || normalized === 'invite_only' || normalized === 'disabled') {
    return normalized
  }
  return 'disabled'
}

export function isOwnerRegistrationOpen(mode: string | null | undefined, hasOwner: boolean): boolean {
  return parseOwnerRegistrationMode(mode) === 'onboarding' && !hasOwner
}
