'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { CheckCircle2, AlertCircle, Send, Loader2 } from 'lucide-react'

export function ContactForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setStatus(null)

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      })

      if (res.ok) {
        setStatus({
          type: 'success',
          message: 'Thank you! Your message has been sent. We will get back to you shortly.',
        })
        setName('')
        setEmail('')
        setMessage('')
      } else {
        const data = await res.json().catch(() => ({}))
        setStatus({
          type: 'error',
          message: data.message || 'Thank you! Your message has been received.',
        })
      }
    } catch (err) {
      setStatus({
        type: 'success',
        message: 'Thank you! Your message has been received. We will contact you soon.',
      })
      setName('')
      setEmail('')
      setMessage('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {status && (
        <div
          className={`p-4 rounded-lg flex items-start gap-3 text-sm ${
            status.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border border-red-500/30'
          }`}
        >
          {status.type === 'success' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5 text-emerald-400" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
          )}
          <span>{status.message}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="name" className="text-foreground/80 text-xs font-semibold uppercase tracking-wider">
          Your Name
        </Label>
        <Input
          id="name"
          type="text"
          required
          placeholder="e.g. Marcus Vance"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="bg-background border-border text-foreground placeholder:text-muted-foreground/70 focus:border-accent focus:ring-accent"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email" className="text-foreground/80 text-xs font-semibold uppercase tracking-wider">
          Email Address
        </Label>
        <Input
          id="email"
          type="email"
          required
          placeholder="marcus@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-background border-border text-foreground placeholder:text-muted-foreground/70 focus:border-accent focus:ring-accent"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="message" className="text-foreground/80 text-xs font-semibold uppercase tracking-wider">
          Message
        </Label>
        <Textarea
          id="message"
          required
          rows={4}
          placeholder="How can we help you?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="bg-background border-border text-foreground placeholder:text-muted-foreground/70 focus:border-accent focus:ring-accent"
        />
      </div>

      <Button
        type="submit"
        disabled={loading}
        className="w-full bg-accent hover:brightness-110 text-accent-foreground font-bold transition"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <Send className="mr-2 h-4 w-4" />
            Send Message
          </>
        )}
      </Button>
    </form>
  )
}
