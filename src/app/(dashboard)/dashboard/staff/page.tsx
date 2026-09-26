'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  UserPlus, Trash2, KeyRound, Shield, Loader2, AlertCircle,
  Mail, Crown, Scissors, Copy, Check, X
} from 'lucide-react'

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
  const [copied, setCopied] = useState(false)

  const [form, setForm] = useState({ name: '', email: '', role: 'BARBER' })

  useEffect(() => { fetchStaff() }, [])

  const fetchStaff = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/staff')
      const data = await res.json()
      setStaff(data.staff || [])
    } catch { setStaff([]) }
    finally { setLoading(false) }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/dashboard/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to invite')
        return
      }

      setStaff([...staff, data.user])
      setTempCreds({ email: data.user.email, password: data.tempPassword })
      setForm({ name: '', email: '', role: 'BARBER' })
      setShowForm(false)
    } catch {
      setError('Network error')
    } finally { setSubmitting(false) }
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

  const handleChangeRole = async (id: string, role: string) => {
    try {
      const res = await fetch(`/api/dashboard/staff/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) return
      setStaff(staff.map(s => s.id === id ? { ...s, role } : s))
    } catch {}
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
          <h1 className="text-2xl font-bold text-zinc-100">Staff Management</h1>
          <p className="text-sm text-zinc-400 mt-1">Invite team members and manage their access.</p>
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
        <Card className="bg-zinc-900 border-amber-500/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-amber-300">Temporary Credentials — Share Securely</p>
              <Button size="sm" variant="ghost" onClick={() => setTempCreds(null)} className="text-zinc-400 hover:text-zinc-200">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="rounded-lg bg-zinc-800 p-3 font-mono text-sm space-y-1">
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-zinc-300">{tempCreds.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <KeyRound className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-zinc-300">{tempCreds.password}</span>
              </div>
            </div>
            <Button size="sm" onClick={copyCreds} variant="outline" className="border-zinc-700 text-zinc-300">
              {copied ? <><Check className="w-3.5 h-3.5 mr-1" /> Copied</> : <><Copy className="w-3.5 h-3.5 mr-1" /> Copy Credentials</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invite form */}
      {showForm && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="p-4">
            <form onSubmit={handleInvite} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Name</label>
                  <input
                    type="text" required value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="John Doe"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1">Email</label>
                  <input
                    type="email" required value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="john@barbershop.com"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">Role</label>
                <div className="flex gap-3">
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    form.role === 'BARBER' ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 hover:border-zinc-600'
                  }`}>
                    <input type="radio" name="role" value="BARBER" checked={form.role === 'BARBER'}
                      onChange={() => setForm({ ...form, role: 'BARBER' })}
                      className="sr-only" />
                    <Scissors className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm text-zinc-200">Barber</span>
                  </label>
                  <label className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer transition-colors ${
                    form.role === 'OWNER' ? 'border-amber-500 bg-amber-500/10' : 'border-zinc-700 hover:border-zinc-600'
                  }`}>
                    <input type="radio" name="role" value="OWNER" checked={form.role === 'OWNER'}
                      onChange={() => setForm({ ...form, role: 'OWNER' })}
                      className="sr-only" />
                    <Crown className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm text-zinc-200">Owner (full access)</span>
                  </label>
                </div>
              </div>
              <div className="flex gap-3">
                <Button type="submit" disabled={submitting} className="bg-amber-500 text-black hover:bg-amber-400">
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Send Invite
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}
                  className="border-zinc-700 text-zinc-300 hover:bg-zinc-800">
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
          <Card className="bg-zinc-900 border-zinc-800 p-12 text-center">
            <UserPlus className="w-10 h-10 mx-auto text-zinc-600 mb-3" />
            <p className="text-zinc-400">No staff members yet. Invite your first team member.</p>
          </Card>
        ) : (
          staff.map((member) => (
            <Card key={member.id} className="bg-zinc-900 border-zinc-800">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    member.role === 'OWNER' ? 'bg-amber-500/10 text-amber-400' : 'bg-blue-500/10 text-blue-400'
                  }`}>
                    {member.role === 'OWNER' ? <Crown className="w-5 h-5" /> : <Scissors className="w-5 h-5" />}
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-100">{member.name}</p>
                    <p className="text-sm text-zinc-400">{member.email}</p>
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
                    <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border bg-zinc-700/30 text-zinc-400 border-zinc-600/40">
                      Deactivated
                    </span>
                  )}
                  <Button size="sm" variant="ghost" title={member.isActive ? 'Deactivate (blocks sign-in)' : 'Reactivate account'} onClick={() => handleToggleActive(member.id, member.name, member.isActive)}
                    className="text-zinc-400 hover:text-blue-400 hover:bg-blue-950/30">
                    {member.isActive ? <X className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleResetPassword(member.id, member.name)}
                    className="text-zinc-400 hover:text-amber-400 hover:bg-amber-950/30">
                    <KeyRound className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleRemove(member.id, member.name)}
                    className="text-zinc-400 hover:text-red-400 hover:bg-red-950/30">
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
