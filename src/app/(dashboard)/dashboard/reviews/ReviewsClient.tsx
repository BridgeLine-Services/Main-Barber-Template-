'use client'

import { useState } from 'react'
import { Star, Trash2, Quote, Plus, X, Search, Scissors } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface Barber {
  id: string
  name: string
  slug: string | null
}

interface Review {
  id: string
  authorName: string
  rating: number
  comment: string | null
  isFeatured: boolean
  isGoogleReview: boolean
  barberId: string | null
  barberName: string | null
  barberSlug: string | null
  createdAt: string
}

export function ReviewsClient({
  initialReviews,
  barbers,
  avgRating,
  total,
  businessId,
}: {
  initialReviews: Review[]
  barbers: Barber[]
  avgRating: string
  total: number
  businessId: string
}) {
  const [reviews, setReviews] = useState(initialReviews)
  const [filter, setFilter] = useState<'all' | 'unassigned' | string>('all')
  const [showAddForm, setShowAddForm] = useState(false)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  // Add review form state
  const [newAuthor, setNewAuthor] = useState('')
  const [newRating, setNewRating] = useState(5)
  const [newComment, setNewComment] = useState('')
  const [newBarberId, setNewBarberId] = useState('')
  const [adding, setAdding] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const filteredReviews = filter === 'all'
    ? reviews
    : filter === 'unassigned'
      ? reviews.filter(r => !r.barberId)
      : reviews.filter(r => r.barberId === filter)

  const toggleFeatured = async (id: string, featured: boolean) => {
    try {
      const res = await fetch('/api/dashboard/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, isFeatured: !featured }),
      })
      if (res.ok) {
        setReviews(prev => prev.map(r => r.id === id ? { ...r, isFeatured: !featured } : r))
      }
    } catch (err) {
      console.error('Toggle error:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this review?')) return
    try {
      await fetch(`/api/dashboard/reviews?id=${id}`, { method: 'DELETE' })
      setReviews(prev => prev.filter(r => r.id !== id))
    } catch (err) {
      console.error('Delete error:', err)
    }
  }

  const assignBarber = async (reviewId: string, barberId: string) => {
    setAssigningId(reviewId)
    try {
      const res = await fetch('/api/dashboard/reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reviewId, barberId: barberId || null }),
      })
      if (res.ok) {
        const barber = barbers.find(b => b.id === barberId)
        setReviews(prev => prev.map(r =>
          r.id === reviewId
            ? { ...r, barberId: barberId || null, barberName: barber?.name || null, barberSlug: barber?.slug || null }
            : r
        ))
      }
    } catch (err) {
      console.error('Assign error:', err)
    } finally {
      setAssigningId(null)
    }
  }

  const handleAddReview = async () => {
    if (!newAuthor.trim()) return
    setAdding(true)
    setFormError(null)
    try {
      const res = await fetch('/api/dashboard/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          authorName: newAuthor.trim(),
          rating: newRating,
          comment: newComment.trim() || undefined,
          barberId: newBarberId || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Failed to add review')
      }
      const created = await res.json().catch(() => null)
      if (!created?.id) throw new Error('Review was not created')
      {
        const barber = barbers.find(b => b.id === newBarberId)
        setReviews(prev => [{
          id: created.id,
          authorName: created.authorName,
          rating: created.rating,
          comment: created.comment,
          isFeatured: false,
          isGoogleReview: false,
          barberId: created.barberId || null,
          barberName: barber?.name || null,
          barberSlug: barber?.slug || null,
          createdAt: created.createdAt,
        }, ...prev])
        // Reset form
        setNewAuthor('')
        setNewRating(5)
        setNewComment('')
        setNewBarberId('')
        setShowAddForm(false)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add review'
      setFormError(message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 font-serif">Reviews</h1>
          <p className="text-sm text-zinc-400 mt-1">Manage customer reviews and assign to barbers</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 bg-zinc-900/50 border border-zinc-800 rounded-xl px-4 py-2.5">
            <Star className="w-6 h-6 text-amber-400 fill-amber-400" />
            <div>
              <p className="text-2xl font-bold text-zinc-100 leading-none">{avgRating}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{total} reviews</p>
            </div>
          </div>
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-amber-500 hover:bg-amber-600 text-zinc-900 font-semibold"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Review
          </Button>
        </div>
      </div>

      {/* Add Review Form */}
      {showAddForm && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-200">Add a Review Manually</h3>
            <button onClick={() => setShowAddForm(false)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          {formError && <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{formError}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Customer Name</label>
              <Input
                value={newAuthor}
                onChange={e => setNewAuthor(e.target.value)}
                placeholder="John Doe"
                className="bg-zinc-800 border-zinc-700"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 mb-1 block">Assign to Barber (optional)</label>
              <select
                value={newBarberId}
                onChange={e => setNewBarberId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white text-sm"
              >
                <option value="">Shop review (no specific barber)</option>
                {barbers.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Rating</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(s => (
                <button
                  key={s}
                  onClick={() => setNewRating(s)}
                  className="p-1"
                >
                  <Star
                    className={cn(
                      'w-6 h-6 transition-colors',
                      s <= newRating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700 hover:text-zinc-500'
                    )}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 mb-1 block">Comment (optional)</label>
            <Textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Great haircut, highly recommend!"
              className="bg-zinc-800 border-zinc-700 min-h-[80px]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setShowAddForm(false)}
              variant="outline"
              className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddReview}
              disabled={!newAuthor.trim() || adding}
              className="bg-amber-500 hover:bg-amber-600 text-zinc-900 font-semibold"
            >
              {adding ? 'Adding...' : 'Add Review'}
            </Button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      {barbers.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              filter === 'all'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            )}
          >
            All ({reviews.length})
          </button>
          <button
            onClick={() => setFilter('unassigned')}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              filter === 'unassigned'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
            )}
          >
            Unassigned ({reviews.filter(r => !r.barberId).length})
          </button>
          {barbers.map(b => {
            const count = reviews.filter(r => r.barberId === b.id).length
            if (count === 0) return null
            return (
              <button
                key={b.id}
                onClick={() => setFilter(b.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  filter === b.id
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                )}
              >
                {b.name} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Reviews List */}
      {filteredReviews.length === 0 ? (
        <div className="text-center py-16">
          <Quote className="w-12 h-12 text-zinc-700 mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">
            {reviews.length === 0
              ? 'No reviews yet. Add one manually or wait for customers to submit reviews.'
              : 'No reviews match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReviews.map(r => (
            <div
              key={r.id}
              className={cn(
                'bg-zinc-900/50 border rounded-xl p-5',
                r.isFeatured ? 'border-amber-500/30' : 'border-zinc-800'
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-300 font-semibold shrink-0">
                    {r.authorName[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-zinc-200">{r.authorName}</span>
                      {r.isFeatured && (
                        <span className="text-xs px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                          Featured
                        </span>
                      )}
                      {r.isGoogleReview && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                          Google
                        </span>
                      )}
                      {r.barberName && (
                        <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-medium flex items-center gap-1">
                          <Scissors className="w-3 h-3" />
                          {r.barberName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 mt-1">
                      {[1, 2, 3, 4, 5].map(s => (
                        <Star
                          key={s}
                          className={cn(
                            'w-3.5 h-3.5',
                            s <= r.rating ? 'text-amber-400 fill-amber-400' : 'text-zinc-700'
                          )}
                        />
                      ))}
                      <span className="text-xs text-zinc-500 ml-2">
                        {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                    {r.comment && (
                      <p className="text-sm text-zinc-400 mt-2 italic">"{r.comment}"</p>
                    )}

                    {/* Barber assignment dropdown */}
                    {barbers.length > 0 && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs text-zinc-500">Barber:</span>
                        <select
                          value={r.barberId || ''}
                          onChange={e => assignBarber(r.id, e.target.value)}
                          disabled={assigningId === r.id}
                          className="text-xs px-2 py-1 bg-zinc-800 border border-zinc-700 rounded-md text-zinc-300 disabled:opacity-50"
                        >
                          <option value="">Unassigned (shop review)</option>
                          {barbers.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => toggleFeatured(r.id, r.isFeatured)}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                      r.isFeatured
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200'
                    )}
                  >
                    {r.isFeatured ? 'Unfeature' : 'Feature'}
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="w-7 h-7 rounded-md bg-zinc-800 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 flex items-center justify-center transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
