'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Trash2, Gift, Save, Trophy } from 'lucide-react'

export interface Tier {
  threshold: number
  reward: string
  rewardType: 'DISCOUNT' | 'FREE_SERVICE' | 'CUSTOM'
  discountValue?: number
}

interface LoyaltyClientProps {
  initialProgram: {
    id: string
    name: string
    type: 'VISITS' | 'POINTS'
    tiers: Tier[]
    pointsPerDollar: number | null
    isActive: boolean
  } | null
}

export function LoyaltyClient({ initialProgram }: LoyaltyClientProps) {
  const [name, setName] = useState(initialProgram?.name || '')
  const [type, setType] = useState<'VISITS' | 'POINTS'>(initialProgram?.type || 'VISITS')
  const [pointsPerDollar, setPointsPerDollar] = useState(initialProgram?.pointsPerDollar || 1)
  const [tiers, setTiers] = useState<Tier[]>(initialProgram?.tiers || [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const addTier = () => {
    setTiers([...tiers, { threshold: tiers.length + 1, reward: '', rewardType: 'DISCOUNT', discountValue: 0 }])
  }

  const removeTier = (index: number) => {
    setTiers(tiers.filter((_, i) => i !== index))
  }

  const updateTier = (index: number, field: keyof Tier, value: Tier[keyof Tier]) => {
    const updated = [...tiers]
    updated[index] = { ...updated[index], [field]: value }
    setTiers(updated)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)

    try {
      const res = await fetch('/api/dashboard/loyalty/program', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Loyalty Program',
          type,
          tiers: [...tiers].sort((a, b) => a.threshold - b.threshold),
          pointsPerDollar: type === 'POINTS' ? pointsPerDollar : null,
          isActive: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      alert(err.message || 'Failed to save loyalty program')
    } finally {
      setSaving(false)
    }
  }

  const metricLabel = type === 'POINTS' ? 'points' : 'visits'

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-serif text-foreground flex items-center gap-2">
            <Gift className="w-6 h-6 text-[var(--dash-brand)]" />
            Loyalty Program
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Configure your shop's reward system
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
        >
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
          ) : saved ? (
            <><Trophy className="w-4 h-4 mr-2 text-emerald-400" />Saved!</>
          ) : (
            <><Save className="w-4 h-4 mr-2" />Save Program</>
          )}
        </Button>
      </div>

      {/* Program Settings */}
      <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5">Program Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Loyalty Program"
              className="bg-card border-border text-foreground"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5">Program Type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'VISITS' | 'POINTS')}
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-ring/50 focus:outline-none"
            >
              <option value="VISITS">Visit-based (e.g. 5 visits = $5 off)</option>
              <option value="POINTS">Points-based (e.g. $1 spent = 1 point)</option>
            </select>
          </div>
        </div>

        {type === 'POINTS' && (
          <div className="sm:w-1/2">
            <Label className="text-xs text-muted-foreground mb-1.5">Points per Dollar Spent</Label>
            <Input
              type="number"
              value={pointsPerDollar}
              onChange={(e) => setPointsPerDollar(Number(e.target.value))}
              min="0.5"
              step="0.5"
              className="bg-card border-border text-foreground"
            />
          </div>
        )}
      </div>

      {/* Reward Tiers */}
      <div className="bg-[var(--dash-surface)] border border-border rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-serif text-foreground">Reward Tiers</h2>
          <Button
            onClick={addTier}
            variant="outline"
            size="sm"
            className="bg-card border-border text-foreground/85 hover:bg-[var(--dash-hover)]"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Tier
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Set up rewards customers earn based on their {metricLabel}. Tiers are automatically sorted by threshold.
        </p>

        {tiers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed border-border rounded-xl">
            <Gift className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm">No reward tiers configured yet.</p>
            <p className="text-xs mt-1">Click "Add Tier" to create your first reward.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...tiers].sort((a, b) => a.threshold - b.threshold).map((tier, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-3 bg-card/60 border border-border/60 rounded-xl p-4"
              >
                <div className="w-28">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                    {type === 'POINTS' ? 'Points' : 'Visits'}
                  </Label>
                  <Input
                    type="number"
                    value={tier.threshold}
                    onChange={(e) => updateTier(index, 'threshold', Number(e.target.value))}
                    min="1"
                    className="bg-card border-border text-foreground"
                  />
                </div>
                <div className="w-36">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reward Type</Label>
                  <select
                    value={tier.rewardType}
                    onChange={(e) => updateTier(index, 'rewardType', e.target.value)}
                    className="w-full bg-card border border-border rounded-lg px-2 py-2 text-sm text-foreground focus:border-ring/50 focus:outline-none"
                  >
                    <option value="DISCOUNT">Discount ($)</option>
                    <option value="FREE_SERVICE">Free Service</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Reward Description</Label>
                  <Input
                    value={tier.reward}
                    onChange={(e) => updateTier(index, 'reward', e.target.value)}
                    placeholder={tier.rewardType === 'DISCOUNT' ? '$5 off' : tier.rewardType === 'FREE_SERVICE' ? 'Free beard trim' : 'Custom reward'}
                    className="bg-card border-border text-foreground"
                  />
                </div>
                {tier.rewardType === 'DISCOUNT' && (
                  <div className="w-28">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Amount ($)</Label>
                    <Input
                      type="number"
                      value={tier.discountValue || 0}
                      onChange={(e) => updateTier(index, 'discountValue', Number(e.target.value))}
                      min="0"
                      className="bg-card border-border text-foreground"
                    />
                  </div>
                )}
                <Button
                  onClick={() => removeTier(index)}
                  variant="ghost"
                  size="icon"
                  className="bg-card border border-border text-muted-foreground hover:text-red-400 hover:bg-red-950/30"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {tiers.length > 0 && (
          <div className="bg-primary/5 border border-[var(--dash-brand-border)] rounded-xl p-4 mt-4">
            <p className="text-xs text-[var(--dash-brand)] font-semibold mb-2">Preview:</p>
            <div className="flex flex-wrap gap-2">
              {[...tiers].sort((a, b) => a.threshold - b.threshold).map((tier, i) => (
                <span key={i} className="text-xs bg-card border border-border text-foreground/85 px-3 py-1.5 rounded-lg">
                  <span className="text-[var(--dash-brand)] font-bold">{tier.threshold}</span> {metricLabel} = {tier.reward || '???'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
