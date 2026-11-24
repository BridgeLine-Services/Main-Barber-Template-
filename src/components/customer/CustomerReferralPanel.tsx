'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Check, Copy, Gift, Share2 } from 'lucide-react'

interface ReferralInfo {
  enabled: boolean
  code: string | null
  link: string | null
  activity: { referredCustomers: number; completedBookings: number } | null
}

async function loadReferralInfo(url: string): Promise<ReferralInfo> {
  const response = await fetch(url, { method: 'POST', cache: 'no-store' })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Referral details are temporarily unavailable.')
  return data
}

export function CustomerReferralPanel() {
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const { data: info, error: loadError } = useSWR<ReferralInfo>('/api/portal/referrals', loadReferralInfo, { revalidateOnFocus: false })

  const copy = async () => {
    if (!info?.link) return
    try { await navigator.clipboard.writeText(info.link); setMessage('Your link is copied and ready to share.') }
    catch { setError('Copy is unavailable in this browser. You can select the link below and copy it.') }
  }

  const share = async () => {
    if (!info?.link) return
    if (navigator.share) {
      try { await navigator.share({ title: 'Book with us', text: 'Join me at the shop I visit. Use my referral link when you book.', url: info.link }) }
      catch (reason) { if (reason instanceof Error && reason.name !== 'AbortError') await copy() }
    } else await copy()
  }

  return (
    <section aria-labelledby="customer-referrals-title" className="rounded-2xl border border-border bg-card p-5 sm:p-7">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-primary/10 p-3 text-primary"><Gift aria-hidden="true" className="size-5" /></span>
        <div><h2 id="customer-referrals-title" className="text-xl font-bold">Share the shop</h2><p className="mt-1 text-sm text-muted-foreground">Invite someone new to book with your personal referral link.</p></div>
      </div>
      {(error || loadError) && <p role="alert" className="mt-4 text-sm text-destructive">{error || loadError.message}</p>}
      {info && !info.enabled && <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">The shop&apos;s referral program is currently turned off. Your referral history is kept, and sharing will be available when the program is active again.</p>}
      {info?.enabled && info.code && info.link && <>
        <div className="mt-5 rounded-xl border border-border bg-background p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your referral code</p><p className="mt-1 font-mono text-xl font-semibold tracking-wider">{info.code}</p><p className="mt-3 break-all text-xs text-muted-foreground">{info.link}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"><Share2 aria-hidden="true" className="size-4" />Share link</button><button type="button" onClick={copy} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium"><Copy aria-hidden="true" className="size-4" />Copy link</button></div></div>
        <div className="mt-4"><h3 className="text-sm font-semibold">How it works</h3><ol className="mt-2 list-inside list-decimal text-sm leading-7 text-muted-foreground"><li>Send your link to someone who is new to this shop.</li><li>They open the link and book their first visit.</li><li>When that first booking is recorded, it appears in your activity.</li></ol></div>
      </>}
      {info?.activity && <div className="mt-4 rounded-lg bg-muted/60 p-4"><h3 className="text-sm font-semibold">Your referral activity</h3><p className="mt-1 text-sm text-muted-foreground">{info.activity.referredCustomers} {info.activity.referredCustomers === 1 ? 'customer' : 'customers'} attributed to your link · {info.activity.completedBookings} completed {info.activity.completedBookings === 1 ? 'booking' : 'bookings'}.</p><p className="mt-1 text-xs text-muted-foreground">We only show totals here, never another customer&apos;s name or contact details.</p></div>}
      {message && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-primary"><Check aria-hidden="true" className="size-4" />{message}</p>}
    </section>
  )
}
