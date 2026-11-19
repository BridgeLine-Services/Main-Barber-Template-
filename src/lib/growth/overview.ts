/**
 * The Business Growth Center's decisions, separated from its rendering.
 *
 * Priority 3 of the commercial directive asks for one owner-facing place that brings the
 * existing marketing, review, rebooking and retention machinery together. The machinery
 * already exists and is tested; what was missing was a single honest summary. This module
 * is pure so every rule can be pinned: a count that could not be read is never shown as
 * zero, nothing is called healthy without a number behind it, and no card promises
 * revenue it cannot know.
 */

export type GrowthState = 'healthy' | 'needs-attention' | 'not-configured' | 'could-not-check'

export interface GrowthInput {
  /** Customers the campaign audience resolves to, or null when the read failed. */
  audienceCount: number | null
  /** Customers past their usual return date. */
  dueCount: number | null
  /** Customers who have drifted past a normal gap. */
  atRiskCount: number | null
  /** Rebooking reminders waiting to go out. */
  rebookingWaiting: number | null
  /** Campaigns recorded for this shop. */
  campaignCount: number | null
  /** ISO timestamp of the last campaign send, or null when none is recorded. */
  lastCampaignSentAt: string | null
  /** Review invitations already sent. */
  reviewInvitesSent: number | null
  /** True when an email provider is configured for this shop. */
  emailConfigured: boolean | null
}

export interface GrowthCard {
  id: 'reach' | 'returning' | 'rebooking' | 'campaigns' | 'reviews' | 'copy' | 'google'
  title: string
  state: GrowthState
  headline: string
  detail: string
  action: string | null
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function buildGrowthCards(input: GrowthInput): GrowthCard[] {
  const cards: GrowthCard[] = []

  // Reach: how many customers a campaign could address at all.
  if (input.audienceCount === null) {
    cards.push({
      id: 'reach',
      title: 'Who you can reach',
      state: 'could-not-check',
      headline: 'We could not read your customer list just now.',
      detail: 'This is a problem with the check, not with your customer records. Nothing was changed.',
      action: 'Reload the page in a moment. If it keeps happening, ask for a technical review.',
    })
  } else if (input.audienceCount === 0) {
    cards.push({
      id: 'reach',
      title: 'Who you can reach',
      state: 'not-configured',
      headline: 'No customers can be emailed yet.',
      detail: 'Customers appear here once they have booked and agreed to hear from you.',
      action: 'Nothing to do until you have customers with permission.',
    })
  } else {
    cards.push({
      id: 'reach',
      title: 'Who you can reach',
      state: 'healthy',
      headline: `You can email ${plural(input.audienceCount, 'customer', 'customers')}.`,
      detail: 'Only customers who agreed to hear from you are counted.',
      action: null,
    })
  }

  // Returning: the retention signal that actually changes behaviour.
  if (input.dueCount === null && input.atRiskCount === null) {
    cards.push({
      id: 'returning',
      title: 'Customers due back',
      state: 'could-not-check',
      headline: 'We could not check who is due back.',
      detail: 'This page does not read appointment history yet, so it cannot tell who is due. Nothing is wrong with your records.',
      action: 'Use the rebooking list, which does read it.',
    })
  } else {
    const due = input.dueCount ?? 0
    const risk = input.atRiskCount ?? 0
    const state: GrowthState = due + risk > 0 ? 'needs-attention' : 'healthy'
    cards.push({
      id: 'returning',
      title: 'Customers due back',
      state,
      headline:
        due + risk === 0
          ? 'Nobody is overdue for a visit.'
          : `${plural(due, 'customer is', 'customers are')} due back and ${risk} drifting away.`,
      detail:
        due + risk === 0
          ? 'Everyone who visited recently is still inside their usual gap.'
          : 'These are the people a reminder helps most, and they are already on your list.',
      action: due + risk === 0 ? null : 'Send a reminder from the campaigns below.',
    })
  }

  // Rebooking: reminders that exist but have not gone out.
  if (input.rebookingWaiting === null) {
    cards.push({
      id: 'rebooking',
      title: 'Rebooking reminders',
      state: 'could-not-check',
      headline: 'We could not count your rebooking reminders.',
      detail: 'The reminder list did not load, so no number is shown rather than a wrong one.',
      action: 'Reload the page in a moment.',
    })
  } else if (input.rebookingWaiting === 0) {
    cards.push({
      id: 'rebooking',
      title: 'Rebooking reminders',
      state: 'healthy',
      headline: 'No reminders are waiting.',
      detail: 'Anything new appears here as soon as a customer is due.',
      action: null,
    })
  } else {
    cards.push({
      id: 'rebooking',
      title: 'Rebooking reminders',
      state: 'needs-attention',
      headline: `${plural(input.rebookingWaiting, 'reminder is', 'reminders are')} waiting to go out.`,
      detail: 'These are customers whose usual gap has passed without a new booking.',
      action: 'Review and send them from the rebooking list.',
    })
  }

  // Campaigns: configured or not, and whether one has ever gone out.
  if (input.campaignCount === null) {
    cards.push({
      id: 'campaigns',
      title: 'Campaigns',
      state: 'could-not-check',
      headline: 'We could not read your campaigns.',
      detail: 'Your existing campaigns are not affected by this check failing.',
      action: 'Reload the page in a moment.',
    })
  } else if (input.campaignCount === 0) {
    cards.push({
      id: 'campaigns',
      title: 'Campaigns',
      state: 'not-configured',
      headline: 'You have not sent a campaign yet.',
      detail: 'A campaign is a message to a group of customers, such as everyone due back this month.',
      action: 'Start with the customers due back, since they already know your shop.',
    })
  } else {
    const when = input.lastCampaignSentAt
      ? new Date(input.lastCampaignSentAt).toLocaleDateString()
      : null
    cards.push({
      id: 'campaigns',
      title: 'Campaigns',
      state: 'healthy',
      headline: `${plural(input.campaignCount, 'campaign', 'campaigns')} recorded.`,
      detail: when ? `The most recent one went out on ${when}.` : 'None has been sent yet.',
      action: null,
    })
  }

  // Reviews: sending is a workflow that either runs or does not.
  if (input.reviewInvitesSent === null) {
    cards.push({
      id: 'reviews',
      title: 'Review invitations',
      state: 'could-not-check',
      headline: 'We could not count your review invitations.',
      detail: 'No number is shown rather than a misleading zero.',
      action: 'Reload the page in a moment.',
    })
  } else {
    cards.push({
      id: 'reviews',
      title: 'Review invitations',
      state: input.reviewInvitesSent > 0 ? 'healthy' : 'not-configured',
      headline:
        input.reviewInvitesSent > 0
          ? `${plural(input.reviewInvitesSent, 'invitation has', 'invitations have')} gone out.`
          : 'No review invitations have gone out yet.',
      detail:
        input.reviewInvitesSent > 0
          ? 'Invitations are only sent to customers who have actually visited.'
          : 'Invitations need your review link in Settings before they can be sent.',
      action: input.reviewInvitesSent > 0 ? null : 'Add your review link in Settings.',
    })
  }

  // Written copy: no generation path exists, and none is simulated.
  cards.push({
    id: 'copy',
    title: 'Suggested wording',
    state: 'not-configured',
    headline: 'Automatic wording is not available.',
    detail:
      'No text is generated for you, and none is pretended. Write your own words, or ask for help writing them.',
    action: null,
  })

  // Google: status is reported by the Google connection screen, not guessed here.
  cards.push({
    id: 'google',
    title: 'Google listing',
    state: 'not-configured',
    headline: 'Your Google listing is not synced from here.',
    detail:
      'Pushing hours and details to Google is not switched on. Your website shows your own records either way.',
    action: 'Check the Google connection screen for the current state.',
  })

  return cards
}

/** One sentence for the top of the page. Never claims more than the cards support. */
export function summariseGrowth(cards: GrowthCard[]): string {
  const unreadable = cards.filter((c) => c.state === 'could-not-check').length
  const attention = cards.filter((c) => c.state === 'needs-attention').length
  if (unreadable > 0) {
    return `${unreadable} of these checks could not be read just now. What is shown is still accurate for the parts that did load.`
  }
  if (attention === 0) return 'Nothing needs your attention here today.'
  return attention === 1 ? 'One thing here is worth your attention.' : `${attention} things here are worth your attention.`
}
