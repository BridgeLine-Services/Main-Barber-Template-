'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  UserPlus, Trash2, KeyRound, Shield, Loader2, AlertCircle,
  Mail, Crown, Scissors, Copy, Check, X
, ShieldCheck } from 'lucide-react'

interface StaffMember {
  id: string
  email: string
  name: string
  role: string
  barberId: string | null
  isActive: boolean
  createdAt: string
}

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [tempCreds, setTempCreds] = useState<{ email: string; password: string } | null>(null)
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string } | null>(null)
  const [invitations, setInvitations] = useState<Array<{ id: string; email: string; name: string; role: string; expiresAt: string }>>([])
  const [copied, setCopied] = useState(false)

  const [form, setForm] = useState({ name: '', email: '', role: 'BARBER', barberId: '' })
  const [barbers, setBarbers] = useState<{ id: string; name: string; isActive: boolean }[]>([])
  const [transferring, setTransferring] = useState<string | null>(null)
  const { data: session } = useSession()

  // Barber profiles for staff <-> barber linking (owner view)
  useEffect(() => {
    fetch('/api/dashboard/barbers')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => setBarbers(Array.isArray(data) ? (data as Array<{ id: string; name: string; isActive: boolean }>).map((b) => ({ id: b.id, name: b.name, isActive: b.isActive })) : []))
      .catch(() => setBarbers([]))
  }, [])

  const fetchStaff = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/staff')
      const data = await res.json()
      setStaff(data.staff || [])
      setInvitations(data.invitations || [])
    } catch { setStaff([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { fetchStaff() }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/dashboard/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          barberId: form.role === 'BARBER' && form.barberId ? form.barberId : undefined,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to invite')
        return
      }

      setInviteLink({ email: data.invitation.email, url: data.inviteUrl })
      setForm({ name: '', email: '', role: 'BARBER', barberId: '' })
      setShowForm(false)
      fetchStaff()
    } catch {
      setError('Network error')
    } finally { setSubmitting(false) }
  }

  const handleRevokeInvite = async (id: string, email: string) => {
    if (!confirm(`Revoke the invitation for ${email}? The link will stop working.`)) return
    try {
      const res = await fetch(`/api/dashboard/staff/invitations/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to revoke invitation')
        return
      }
      fetchStaff()
    } catch {
      setError('Network error')
    }
  }

  const handleResetPassword = async (id: string, name: string) => {
    if (!confirm(`Reset password for ${name}? They'll need a new temporary password.`)) return

    try {
      const res = await fetch(`/api/dashboard/staff/${id}`, { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to reset password')
        return
      }

      const member = staff.find(s => s.id === id)
      setTempCreds({ email: member?.email || '', password: data.tempPassword })
    } catch {
      setError('Network error')
    }
  }

  const handleRemove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name} from staff? This cannot be undone.`)) return

    try {
      const res = await fetch(`/api/dashboard/staff/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to remove')
        return
      }
      setStaff(staff.filter(s => s.id !== id))
    } catch {
      setError('Network error')
    }
  }

  const handleToggleActive = async (id: string, name: string, isActive: boolean) => {
    if (!confirm(
      isActive
        ? `Deactivate ${name}? They will no longer be able to sign in, but their account and history are preserved.`
        : `Reactivate ${name}? They will be able to sign in again with their existing password.`
    )) return

    try {
      const res = await fetch(`/api/dashboard/staff/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to update status')
        return
      }

      fetchStaff()
    } catch {
      setError('Network error')
    }
  }


  const handleTransferOwnership = async (id: string, name: string) => {
    if (!confirm(
      `Transfer ownership to ${name}? You will be demoted to BARBER and must sign in again to see the change. This cannot be undone from your side.`
    )) return
    setTransferring(id)
    try {
      const res = await fetch('/api/dashboard/ownership-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || 'Failed to transfer ownership')
        return
      }
      setError('')
      fetchStaff()
    } catch {
      setError('Network error')
    } finally {
      setTransferring(null)
    }
  }

  const handleLinkBarber = async (id: string, barberId: string) => {
    const prev = staff.find((s) => s.id === id)?.barberId || null
    // optimistic update, revert on failure
    setStaff(staff.map((s) => (s.id === id ? { ...s, barberId: barberId || null } : s)))
    try {
      const res = await fetch(`/api/dashboard/staff/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barberId: barberId || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error || 'Failed to update barber link')
        setStaff(staff.map((s) => (s.id === id ? { ...s, barberId: prev } : s)))
      } else {
        setError('')
      }
    } catch {
      setError('Network error')
      setStaff(staff.map((s) => (s.id === id ? { ...s, barberId: prev } : s)))
    }
  }

  const copyCreds = () => {
    if (tempCreds) {
      navigator.clipboard.writeText(`Email: ${tempCreds.email}\nPassword: ${tempCreds.password}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Staff Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Invite team members and manage their access.</p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} className="bg-amber-500 text-black hover:bg-amber-400">
            <UserPlus className="w-4 h-4 mr-2" /> Invite Staff
          </Button>
        )}
      </div>

      
      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Temp credentials display */}
      {tempCreds && (
        <Card className="bg-card border-amber-500/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-amber-300">Temporary Credentials — Share Securely</p>
              <Button size="sm" variant="ghost" onClick={() => setTempCreds(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="rounded-lg bg-muted p-3 font-mono text-sm space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground/85">{tempCreds.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-foreground/85">{tempCreds.password}</span>
              </div>
            </div>
            <Button size="sm" onClick={copyCreds} variant="outline" className="border-input text-foreground/85">
              {copied ? <><Check className="w-3.5 h-3.5 mr-1" /> Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" /> Copy Credentials</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invitation link display */}
      {inviteLink && (
        <Card className="bg-card border-amber-500/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-amber-300">Invitation Sent — Share This Secure Link</p>
              <Button size="sm" variant="ghost" onClick={() => setInviteLink(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {inviteLink.email} sets their own password via this single-use link (expires in 7 days).
            </p>
            <div className="rounded-lg bg-muted p-3 font-mono text-xs break-all text-foreground/85">{inviteLink.url}</div>
            <Button
              size="sm" variant="outline" className="border-input text-foreground/85"
              onClick={() => {
                navigator.clipboard.writeText(inviteLink.url)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
            >
              {copied ? <><Check className="w-3.5 h-3.5 mr-1" /> Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" /> Copy Link</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <Card className="bg-card border-border">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Pending Invitations ({invitations.length})</p>
            <div className="space-y-2">
              {invitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                  <div>
                    <p className="text-sm text-foreground">{inv.name} <span className="text-muted-foreground">({inv.email})</span></p>
                    <p className="text-xs text-muted-foreground">{inv.role === 'BUSINESS_ADMIN' ? 'Admin' : 'Barber'} · expires {new Date(inv.expiresAt).toLocaleDateString()}</p>
                  </div>
                  <Button size="sm" variant="outline" className="border-red-500/30 text-red-300 hover:bg-red-500/10" onClick={() => handleRevokeInvite(inv.id, inv.email)}>
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invite form */}
      {showForm && (
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Name</label>
                  <input
                    type="text" required value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="John Doe"
                    className="w-full rounded-lg bg-muted border border-input px-3 py-2 text-foreground placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Email</label>
                  <input
                    type="email" required value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="john@barbershop.com"
                    className="w-full rounded-lg bg-muted border border-input px-3 py-2 text-foreground placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Role</label>
                <div className="flex gap-3">
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    form.role === 'BARBER' ? 'border-amber-500 bg-amber-500/10' : 'border-input hover:border-zinc-600'
                  }`}>
                    <input type="radio" name="role" value="BARBER" checked={form.role === 'BARBER'}
                      onChange={() => setForm({ ...form, role: 'BARBER' })}
                      className="sr-only" />
                    <Scissors className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">Barber</span>
                  </label>
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    form.role === 'BUSINESS_ADMIN' ? 'border-amber-500 bg-amber-500/10' : 'border-input hover:border-zinc-600'
                  }`}>
                    <input type="radio" name="role" value="BUSINESS_ADMIN" checked={form.role === 'BUSINESS_ADMIN'}
                      onChange={() => setForm({ ...form, role: 'BUSINESS_ADMIN' })}
                      className="sr-only" />
                    <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">Business Admin (no ownership actions)</span>
                  </label>
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    form.role === 'OWNER' ? 'border-amber-500 bg-amber-500/10' : 'border-input hover:border-zinc-600'
                  }`}>
                    <input type="radio" name="role" value="OWNER" checked={form.role === 'OWNER'}
                      onChange={() => setForm({ ...form, role: 'OWNER' })}
                      className="sr-only" />
                    <Crown className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-foreground">Owner (full access)</span>
                  </label>
                </div>
              </div>
              {form.role === 'BARBER' && (
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Linked Barber Profile</label>
                  <select
                    value={form.barberId}
                    onChange={(e) => setForm({ ...form, barberId: e.target.value })}
                    className="w-full rounded-lg bg-muted border border-input px-3 py-2 text-foreground focus:border-amber-500 focus:outline-none"
                  >
                    <option value="">No link — they'll only see their own profile once linked</option>
                    {barbers.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (inactive)'}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Links this login to a barber profile so their appointments, schedule, and public
                    page line up. You can change this later.
                  </p>
                </div>
              )}
              <div className="flex gap-3">
                <Button type="submit" disabled={submitting} className="bg-amber-500 text-black hover:bg-amber-400">
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Send Invite
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}
                  className="border-input text-foreground/85 hover:bg-[var(--dash-hover)]">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Staff list */}
      <div className="space-y-3">
        {staff.length === 0 && !showForm ? (
          <Card className="bg-card border-border p-12 text-center">
            <UserPlus className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No staff members yet. Invite your first team member.</p>
          </Card>
        ) : (
          staff.map((member) => (
            <Card key={member.id} className="bg-card border-border">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    member.role === 'OWNER' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {member.role === 'OWNER' ? <Crown className="w-5 h-5" /> : <Scissors className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{member.name}</p>
                    <p className="text-sm text-muted-foreground">{member.email}</p>
                    {member.role === 'BARBER' && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Barber profile:</span>
                        <select
                          value={member.barberId || ''}
                          onChange={(e) => handleLinkBarber(member.id, e.target.value)}
                          className="rounded-md bg-muted border border-input px-2 py-1 text-xs text-foreground focus:border-amber-500 focus:outline-none"
                        >
                          <option value="">Not linked</option>
                          {barbers.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}{b.isActive ? '' : ' (inactive)'}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${
                    member.role === 'OWNER'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                  }`}>
                    {member.role}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {member.isActive ? (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                      Active
                    </span>
                  ) : (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-zinc-700/30 text-muted-foreground border-zinc-600/40">
                      Deactivated
                    </span>
                  )}
                  <Button size="sm" variant="ghost" title={member.isActive ? 'Deactivate (blocks sign-in)' : 'Reactivate account'} onClick={() => handleToggleActive(member.id, member.name, member.isActive)}
                    className="text-muted-foreground hover:text-blue-400 hover:bg-blue-950/30">
                    {member.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  </Button>
                  {session?.user?.id !== member.id && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Transfer business ownership to this member"
                      disabled={transferring !== null}
                      onClick={() => handleTransferOwnership(member.id, member.name)}
                      className="text-muted-foreground hover:text-amber-400 hover:bg-amber-950/30"
                    >
                      {transferring === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleResetPassword(member.id, member.name)}
                    className="text-muted-foreground hover:text-amber-400 hover:bg-amber-950/30">
                    <KeyRound className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleRemove(member.id, member.name)}
                    className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
