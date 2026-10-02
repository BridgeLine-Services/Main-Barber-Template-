'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, PlayCircle, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'

interface TestStep {
  step: string
  status: 'pass' | 'fail'
  message: string
}

export default function E2ETestPage() {
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<TestStep[]>([])
  const [summary, setSummary] = useState('')

  const runTest = async () => {
    setRunning(true)
    setResults([])
    setSummary('')

    try {
      const res = await fetch('/api/test/e2e-booking', { method: 'POST' })
      const data = await res.json()
      setResults(data.steps || [])
      setSummary(data.summary || '')
    } catch (err) {
      setResults([{ step: 'error', status: 'fail', message: err.message || 'Request failed' }])
    } finally {
      setRunning(false)
    }
  }

  const stepLabels: Record<string, string> = {
    '0_setup': 'Setup: Find barber + service',
    '1_find_slot': 'Find available slot',
    '3_create_appointment': 'Create appointment',
    '4_verify_tokens': 'Verify confirmation + access token',
    '5_dashboard_query': 'Verify appointment in dashboard queries',
    '6_double_booking': 'Verify double-booking protection',
    '7_cancel': 'Cancel appointment',
    '8_slot_reopened': 'Verify slot reopens after cancellation',
    '9_cleanup': 'Clean up test data',
    'error': 'Error',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">E2E Booking Test</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Runs a full booking lifecycle test against the production database. Creates a test appointment, verifies it, cancels it, and cleans up.
        </p>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-foreground">Test Runner</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={runTest}
            disabled={running}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running tests...
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 mr-2" />
                Run E2E Test
              </>
            )}
          </Button>
          {summary && (
            <div className="mt-4">
              <Badge variant={summary.includes('0') ? 'destructive' : 'default'} className="text-sm">
                {summary}
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {results.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.map((r, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 rounded-lg bg-[var(--dash-surface)]/50 border border-border"
              >
                {r.status === 'pass' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {stepLabels[r.step] || r.step}
                    </span>
                    <Badge
                      variant={r.status === 'pass' ? 'default' : 'destructive'}
                      className="text-xs"
                    >
                      {r.status.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.message}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="bg-amber-500/10 border-amber-600/40">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--dash-brand)] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-200">What this tests</p>
              <p className="text-xs text-amber-200/70 mt-1">
                Database connectivity, availability engine, appointment creation, confirmation/token generation, dashboard queries, double-booking protection, cancellation, and slot reopening. Test data is automatically cleaned up after each run.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
