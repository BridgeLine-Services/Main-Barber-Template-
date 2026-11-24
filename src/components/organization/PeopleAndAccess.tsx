'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeInvitationState, describeRoleAbilities, roleLabel } from '@/lib/organization/invitations'
import type { InvitationDeliveryState, InvitationState, MemberRole } from '@/lib/organization/invitations'

/**
 * "People and access": who is in the organization, and what they may do.
 *
 * Two rules shape this screen. Nothing changes on a single click: every action opens a
 * sentence explaining what it will do, and the change happens only on the second click.
 * And nothing here decides anything: the server re-reads the caller's organization from
 * the session and refuses anything they may not do, so this component's role choices are
 * a convenience, not the permission.
 */

export interface MemberView {
  id: string
  name: string
  email: string
  role: MemberRole
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED'
  isSelf: boolean
  isOwner: boolean
}

export interface InvitationView {
  id: string
  email: string
  role: MemberRole
  state: InvitationState
  stateWords: string
  expiresAt: string
  createdOn: string
  deliveryState: InvitationDeliveryState
  deliveryError: string | null
  sentAt: string | null
}

interface Props {
  canManage: boolean
  members: MemberView[]
  invitations: InvitationView[]
  invitableRoles: MemberRole[]
  allRoles: MemberRole[]
}

const DELIVERY_STATE_WORDS: Record<InvitationDeliveryState, string> = {
  created: 'Created; no email is queued',
  queued: 'Queued',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Delivery failed',
  'retry-scheduled': 'Retry scheduled',
}

const STATUS_WORDS: Record<MemberView['status'], string> = {
  ACTIVE: 'Active',
  INVITED: 'Invitation not accepted yet',
  SUSPENDED: 'Suspended: cannot sign in to the organization',
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'date not recorded'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function PeopleAndAccess({ canManage, members, invitations, invitableRoles, allRoles }: Props) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>(invitableRoles[0] ?? 'REGIONAL_MANAGER')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingRole, setPendingRole] = useState<Record<string, MemberRole>>({})

  async function send(path: string, method: string, body?: unknown, key = path) {
    setBusy(key)
    setNotice(null)
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNotice(typeof data?.error === 'string' ? data.error : 'That did not work. Nothing was changed.')
        return null
      }
      return data as Record<string, unknown>
    } catch {
      setNotice('The connection dropped. Nothing was changed.')
      return null
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    setInviteError(null)
    setInviteLink(null)
    const trimmed = email.trim()
    if (!trimmed.includes('@')) {
      setInviteError('Enter a full email address, like sam@yourshop.com.')
      return
    }
    const data = await send('/api/dashboard/organization/invitations', 'POST', { email: trimmed, role }, 'invite')
    if (!data) return
    const path = typeof data.acceptPath === 'string' ? data.acceptPath : null
    setInviteLink(path)
    setLinkCopied(false)
    setNotice(data.delivery === 'queued'
      ? 'Your invitation was created. Its email is queued for delivery.'
      : 'Your invitation was created, but the email could not be sent. You can copy the link and share it directly.')
    setEmail('')
    router.refresh()
  }

  async function resend(id: string) {
    const data = await send(`/api/dashboard/organization/invitations/${id}`, 'POST', undefined, `resend-${id}`)
    if (!data) return
    setInviteLink(typeof data.acceptPath === 'string' ? data.acceptPath : null)
    setLinkCopied(false)
    setNotice(data.delivery === 'queued'
      ? 'A fresh invitation email is queued. The previous link no longer works.'
      : 'A fresh link was created, but the email could not be sent. Copy and share the new link directly.')
    router.refresh()
  }

  async function cancelInvitation(id: string) {
    const data = await send(`/api/dashboard/organization/invitations/${id}`, 'DELETE', undefined, `cancel-${id}`)
    if (!data) return
    setNotice('The invitation was cancelled. The link no longer works.')
    router.refresh()
  }

  async function changeRole(id: string) {
    const next = pendingRole[id]
    if (!next) return
    const data = await send(`/api/dashboard/organization/members/${id}`, 'PATCH', { role: next }, `role-${id}`)
    if (!data) return
    setNotice('The role was changed.')
    router.refresh()
  }

  async function changeStatus(id: string, status: 'ACTIVE' | 'SUSPENDED') {
    const data = await send(`/api/dashboard/organization/members/${id}`, 'PATCH', { status }, `status-${id}`)
    if (!data) return
    setNotice(status === 'SUSPENDED' ? 'That person can no longer sign in to the organization.' : 'That person can sign in again.')
    router.refresh()
  }

  const fullLink = inviteLink
    ? (typeof window === 'undefined' ? inviteLink : `${window.location.origin}${inviteLink}`)
    : null

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status" aria-live="polite" className="rounded-lg border border-border bg-[var(--dash-surface)] p-3 text-sm text-foreground">
          {notice}
        </div>
      )}

      <section aria-labelledby="members-heading" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="members-heading" className="text-lg font-semibold text-foreground">People in this organization</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {members.length} {members.length === 1 ? 'person' : 'people'}. Roles decide what each person can see and change.
        </p>

        <ul className="mt-4 space-y-3">
          {members.map((member) => (
            <li key={member.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {member.name || member.email}
                    {member.isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground">{roleLabel(member.role)}</span>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">{describeRoleAbilities(member.role)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{STATUS_WORDS[member.status]}</p>

              {canManage && !member.isOwner && !member.isSelf && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[10rem] flex-1">
                      <Label htmlFor={`role-${member.id}`} className="text-xs">Change their role</Label>
                      <select
                        id={`role-${member.id}`}
                        className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                        value={pendingRole[member.id] ?? member.role}
                        onChange={(e) => {
                          setPendingRole((prev) => ({ ...prev, [member.id]: e.target.value as MemberRole }))
                          setConfirming(null)
                        }}
                      >
                        {allRoles.filter((r) => r !== 'ORGANIZATION_OWNER').map((r) => (
                          <option key={r} value={r}>{roleLabel(r)}</option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={busy !== null}
                      onClick={() => setConfirming(`role-${member.id}`)}
                    >
                      Review change
                    </Button>
                  </div>

                  {confirming === `role-${member.id}` && (
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-sm text-foreground">
                        Make {member.name || member.email} a {roleLabel(pendingRole[member.id] ?? member.role)}? They will
                        be able to: {describeRoleAbilities(pendingRole[member.id] ?? member.role)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button type="button" className="min-h-11" disabled={busy !== null} onClick={() => changeRole(member.id)}>
                          Yes, change the role
                        </Button>
                        <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(null)}>
                          Keep it as it is
                        </Button>
                      </div>
                    </div>
                  )}

                  <div>
                    {confirming === `status-${member.id}` ? (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-sm text-foreground">
                          {member.status === 'SUSPENDED'
                            ? `Let ${member.name || member.email} sign in to the organization again?`
                            : `Stop ${member.name || member.email} from signing in to the organization? Their shop records stay exactly as they are.`}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            type="button"
                            className="min-h-11"
                            disabled={busy !== null}
                            onClick={() => changeStatus(member.id, member.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}
                          >
                            {member.status === 'SUSPENDED' ? 'Yes, restore access' : 'Yes, suspend access'}
                          </Button>
                          <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(null)}>
                            Leave them alone
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={busy !== null}
                        onClick={() => setConfirming(`status-${member.id}`)}
                      >
                        {member.status === 'SUSPENDED' ? 'Restore access' : 'Suspend access'}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canManage && (
        <section aria-labelledby="invite-heading" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
          <h2 id="invite-heading" className="text-lg font-semibold text-foreground">Invite someone</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The invitation works once and stops working after seven days. You choose what they may do now; you can change it later.
          </p>

          <form onSubmit={invite} className="mt-4 space-y-3">
            <div>
              <Label htmlFor="invite-email" className="text-xs">Their email address</Label>
              <Input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="mt-1 min-h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="sam@yourshop.com"
                aria-describedby={inviteError ? 'invite-error' : undefined}
              />
            </div>

            <div>
              <Label htmlFor="invite-role" className="text-xs">What they may do</Label>
              <select
                id="invite-role"
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-background px-2 text-sm text-foreground"
                value={role}
                onChange={(e) => setRole(e.target.value as MemberRole)}
              >
                {invitableRoles.map((r) => (
                  <option key={r} value={r}>{roleLabel(r)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">{describeRoleAbilities(role)}</p>
            </div>

            {inviteError && <p id="invite-error" className="text-sm text-red-400">{inviteError}</p>}

            <Button type="submit" className="min-h-11" disabled={busy !== null}>
              {busy === 'invite' ? 'Creating the invitation…' : 'Create the invitation'}
            </Button>
          </form>

          {fullLink && (
            <div className="mt-4 rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">The invitation was created, but the email could not be sent. Copy the link and share it directly.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                It works once, for their email address only, and stops working in seven days. Anyone with the link can accept
                it, so send it the way you would send a password.
              </p>
              <p className="mt-2 break-all rounded border border-border bg-background p-2 text-xs text-foreground">{fullLink}</p>
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(fullLink)
                    setLinkCopied(true)
                  } catch {
                    setLinkCopied(false)
                    setNotice('Copy is unavailable here. Select the link above and copy it manually.')
                  }
                }}
              >
                {linkCopied ? 'Link copied' : 'Copy invitation link'}
              </Button>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="invitations-heading" className="rounded-xl border border-border bg-[var(--dash-surface)] p-5">
        <h2 id="invitations-heading" className="text-lg font-semibold text-foreground">Invitations</h2>
        {invitations.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No invitations have been created.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="truncate font-medium text-foreground">{invitation.email}</p>
                  <span className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground">{roleLabel(invitation.role)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {invitation.stateWords} Created {formatDay(invitation.createdOn)}.{' '}
                  {invitation.sentAt
                    ? `Email sent ${formatDay(invitation.sentAt)}.`
                    : invitation.state === 'pending' ? `Delivery: ${DELIVERY_STATE_WORDS[invitation.deliveryState]}.` : null}{' '}
                  Expires {formatDay(invitation.expiresAt)}.
                </p>
                {invitation.deliveryError && invitation.state === 'pending' && (
                  <p className="mt-2 text-sm text-muted-foreground" role="status">{invitation.deliveryError}</p>
                )}

                {canManage && invitation.state === 'pending' && (
                  <div className="mt-2 space-y-2">
                    {confirming === `inv-${invitation.id}` ? (
                      <div className="rounded-lg border border-border p-3">
                        <p className="text-sm text-foreground">
                          Cancel the invitation to {invitation.email}? The link stops working and they cannot join with it.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" className="min-h-11" disabled={busy !== null} onClick={() => cancelInvitation(invitation.id)}>
                            Yes, cancel it
                          </Button>
                          <Button type="button" variant="outline" className="min-h-11" onClick={() => setConfirming(null)}>
                            Keep it
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={busy !== null}
                          onClick={() => resend(invitation.id)}
                        >
                          Send a new link
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={busy !== null}
                          onClick={() => setConfirming(`inv-${invitation.id}`)}
                        >
                          Cancel invitation
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{describeInvitationState('expired')}</p>
      </section>
    </div>
  )
}
