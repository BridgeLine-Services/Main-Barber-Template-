'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollText, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AuditLogEntry {
  id: string
  action: string
  entityType?: string | null
  entityId?: string | null
  ipAddress?: string | null
  createdAt: string
  user?: { name: string | null; email: string | null } | null
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const limit = 50

  const loadLogs = React.useCallback(async () => {
    try {
      const r = await fetch(`/api/dashboard/audit-logs?limit=${limit}&offset=${offset}`)
      const data = await r.json()
      if (Array.isArray(data.logs)) {
        setLogs(data.logs)
        setHasMore(data.hasMore || false)
        setTotal(data.total || 0)
      }
    } catch {
      // Keep the last successful list on transient failures
    } finally {
      setLoading(false)
    }
  }, [limit, offset])

  useEffect(() => {
    setLoading(true)
    loadLogs()
  }, [loadLogs])

  // Live updates: poll for new entries so the log reflects actual activity
  // without a manual refresh. Skips a redundant fetch when the tab is hidden
  // and pauses on deeper pages (offset > 0) to avoid jumping the view.
  useEffect(() => {
    if (offset !== 0) return
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') loadLogs()
    }, 30_000)
    return () => clearInterval(interval)
  }, [offset, loadLogs])

  // Refresh promptly when the user returns to the tab
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && offset === 0) loadLogs() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [offset, loadLogs])

  const formatAction = (action: string) => {
    return action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-amber-500" />
          Audit Log
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track all administrative actions across your shop. {total} total events.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[40vh]">
          <p className="text-muted-foreground">Loading audit logs...</p>
        </div>
      ) : logs.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="py-12 text-center">
            <ScrollText className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No audit events recorded yet.</p>
            <p className="text-sm text-muted-foreground mt-1">Actions like appointment cancellations, reschedules, and settings changes will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {logs.map((log) => (
              <Card key={log.id} className="bg-card border-border">
                <CardContent className="py-3 px-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-400 bg-amber-500/5">
                          {formatAction(log.action)}
                        </Badge>
                        {log.user && (
                          <span className="text-xs text-muted-foreground">
                            by {log.user.name}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(log.createdAt)}
                        {log.entityType && ` · ${log.entityType}`}
                        {log.entityId && ` · ${log.entityId.substring(0, 8)}...`}
                        {log.ipAddress && ` · ${log.ipAddress}`}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {offset + 1}–{offset + logs.length} of {total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="border-input text-foreground/85 hover:bg-[var(--dash-hover)]"
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasMore}
                onClick={() => setOffset(offset + limit)}
                className="border-input text-foreground/85 hover:bg-[var(--dash-hover)]"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
