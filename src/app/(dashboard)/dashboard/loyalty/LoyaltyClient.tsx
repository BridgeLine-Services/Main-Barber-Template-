'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Trash2, Gift, Save, Trophy } from 'lucide-react'

interface Tier {
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

  const updateTier = (index: number, field: keyof Tier, value: any) => {
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
    } catch (err: any) {
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
          <h1 className="text-2xl font-bold font-serif text-zinc-100 flex items-center gap-2">
            <Gift className="w-6 h-6 text-amber-500" />
            Loyalty Program
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            Configure your shop's reward system
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
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
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-zinc-400 mb-1.5">Program Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Loyalty Program"
              className="bg-zinc-900 border-zinc-800 text-zinc-200"
            />
          </div>
          <div>
            <Label className="text-xs text-zinc-400 mb-1.5">Program Type</Label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'VISITS' | 'POINTS')}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
            >
              <option value="VISITS">Visit-based (e.g. 5 visits = $5 off)</option>
              <option value="POINTS">Points-based (e.g. $1 spent = 1 point)</option>
            </select>
          </div>
        </div>

        {type === 'POINTS' && (
          <div className="sm:w-1/2">
            <Label className="text-xs text-zinc-400 mb-1.5">Points per Dollar Spent</Label>
            <Input
              type="number"
              value={pointsPerDollar}
              onChange={(e) => setPointsPerDollar(Number(e.target.value))}
              min="0.5"
              step="0.5"
              className="bg-zinc-900 border-zinc-800 text-zinc-200"
            />
          </div>
        )}
      </div>

      {/* Reward Tiers */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold font-serif text-zinc-100">Reward Tiers</h2>
          <Button
            onClick={addTier}
            variant="outline"
            size="sm"
            className="bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Tier
          </Button>
        </div>

        <p className="text-xs text-zinc-400">
          Set up rewards customers earn based on their {metricLabel}. Tiers are automatically sorted by threshold.
        </p>

        {tiers.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 border border-dashed border-zinc-800 rounded-xl">
            <Gift className="w-8 h-8 mx-auto mb-2 text-zinc-700" />
            <p className="text-sm">No reward tiers configured yet.</p>
            <p className="text-xs mt-1">Click "Add Tier" to create your first reward.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {[...tiers].sort((a, b) => a.threshold - b.threshold).map((tier, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-3 bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4"
              >
                <div className="w-28">
                  <Label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
                    {type === 'POINTS' ? 'Points' : 'Visits'}
                  </Label>
                  <Input
                    type="number"
                    value={tier.threshold}
                    onChange={(e) => updateTier(index, 'threshold', Number(e.target.value))}
                    min="1"
                    className="bg-zinc-900 border-zinc-800 text-zinc-200"
                  />
                </div>
                <div className="w-36">
                  <Label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Reward Type</Label>
                  <select
                    value={tier.rewardType}
                    onChange={(e) => updateTier(index, 'rewardType', e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-2 text-sm text-zinc-200 focus:border-amber-500/50 focus:outline-none"
                  >
                    <option value="DISCOUNT">Discount ($)</option>
                    <option value="FREE_SERVICE">Free Service</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <Label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Reward Description</Label>
                  <Input
                    value={tier.reward}
                    onChange={(e) => updateTier(index, 'reward', e.target.value)}
                    placeholder={tier.rewardType === 'DISCOUNT' ? '$5 off' : tier.rewardType === 'FREE_SERVICE' ? 'Free beard trim' : 'Custom reward'}
                    className="bg-zinc-900 border-zinc-800 text-zinc-200"
                  />
                </div>
                {tier.rewardType === 'DISCOUNT' && (
                  <div className="w-28">
                    <Label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Amount ($)</Label>
                    <Input
                      type="number"
                      value={tier.discountValue || 0}
                      onChange={(e) => updateTier(index, 'discountValue', Number(e.target.value))}
                      min="0"
                      className="bg-zinc-900 border-zinc-800 text-zinc-200"
                    />
                  </div>
                )}
                <Button
                  onClick={() => removeTier(index)}
                  variant="ghost"
                  size="icon"
                  className="bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 hover:bg-red-950/30"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {tiers.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 mt-4">
            <p className="text-xs text-amber-400 font-semibold mb-2">Preview:</p>
            <div className="flex flex-wrap gap-2">
              {[...tiers].sort((a, b) => a.threshold - b.threshold).map((tier, i) => (
                <span key={i} className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg">
                  <span className="text-amber-400 font-bold">{tier.threshold}</span> {metricLabel} = {tier.reward || '???'}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
