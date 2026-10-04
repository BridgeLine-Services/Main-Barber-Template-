'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import {
  CreditCard,
  Save,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Percent,
  Receipt,
  Users,
  ShieldAlert,
  Plus,
  Trash2,
} from 'lucide-react'

interface PaymentSettings {
  enabled: boolean
  allowBarberCheckout: boolean
  tipsEnabled: boolean
  tipPresets: number[]
  taxEnabled: boolean
  taxRatePercent: number
  depositsEnabled: boolean
  depositType: 'PERCENT' | 'FLAT'
  depositValue: number
  cancellationFeeEnabled: boolean
  cancellationFeeAmount: number
  noShowFeeEnabled: boolean
  noShowFeeAmount: number
  cardOnFileEnabled: boolean
  commissionEnabled: boolean
  commissionRatePercent: number
  receiptsEmailEnabled: boolean
}

export function PaymentSettingsForm() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [settings, setSettings] = useState<PaymentSettings>({
    enabled: false,
    allowBarberCheckout: true,
    tipsEnabled: true,
    tipPresets: [15, 18, 20, 25],
    taxEnabled: false,
    taxRatePercent: 0,
    depositsEnabled: false,
    depositType: 'PERCENT',
    depositValue: 20,
    cancellationFeeEnabled: false,
    cancellationFeeAmount: 25,
    noShowFeeEnabled: false,
    noShowFeeAmount: 50,
    cardOnFileEnabled: false,
    commissionEnabled: false,
    commissionRatePercent: 60,
    receiptsEmailEnabled: true,
  })

  useEffect(() => {
    fetch('/api/dashboard/payments/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.settings) {
          setSettings((prev) => ({
            ...prev,
            ...data.settings,
            tipPresets: Array.isArray(data.settings.tipPresets) ? data.settings.tipPresets : [15, 18, 20, 25],
          }))
        }
        setStripeConfigured(Boolean(data.stripeConfigured))
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/payments/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()

      if (!res.ok) {
        toast({
          title: 'Failed to save settings',
          description: data.error || 'Check input values and server configuration.',
          variant: 'destructive',
        })
      } else if (data.settings) {
        setSettings((prev) => ({
          ...prev,
          ...data.settings,
          tipPresets: Array.isArray(data.settings.tipPresets) ? data.settings.tipPresets : prev.tipPresets,
        }))
        toast({
          title: 'Settings saved',
          description: 'Payment and POS configuration updated successfully.',
        })
      }
    } catch {
      toast({
        title: 'Error saving settings',
        description: 'A network or server error occurred.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const updatePreset = (index: number, val: number) => {
    const updated = [...settings.tipPresets]
    updated[index] = Math.min(100, Math.max(0, val))
    setSettings({ ...settings, tipPresets: updated })
  }

  const addPreset = () => {
    if (settings.tipPresets.length >= 6) return
    const nextVal = settings.tipPresets.length > 0 ? (settings.tipPresets[settings.tipPresets.length - 1] || 10) + 5 : 15
    setSettings({ ...settings, tipPresets: [...settings.tipPresets, Math.min(100, nextVal)] })
  }

  const removePreset = (index: number) => {
    if (settings.tipPresets.length <= 1) return
    const updated = settings.tipPresets.filter((_, i) => i !== index)
    setSettings({ ...settings, tipPresets: updated })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-sm text-muted-foreground">Loading payment settings...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold font-serif text-foreground flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-[var(--dash-brand)]" />
            <span>Payments &amp; POS Settings</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Configure in-shop checkout, credit card processing, tips, taxes, deposits, and fee policies.
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-black hover:bg-primary/90 font-semibold text-sm gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>

      {/* Stripe Warning Banner if not configured */}
      {!stripeConfigured && !settings.enabled && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 space-y-1">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Stripe Secret Key Required to Enable Online / Card Processing</span>
          </div>
          <p className="text-xs text-amber-300/80 leading-relaxed">
            <code className="font-mono bg-amber-950/50 px-1 py-0.5 rounded">STRIPE_SECRET_KEY</code> is not configured on this server. The shop currently runs in pay-at-shop mode. Once server environment variables are added, you can toggle Payments &amp; POS on below.
          </p>
        </div>
      )}

      {/* Master Toggle & Explanation */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg font-bold text-foreground">Payments &amp; POS Master Switch</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Turn on card payments, terminal checkouts, online deposits, and automatic receipt generation.
              </CardDescription>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(checked) => setSettings({ ...settings, enabled: checked })}
              disabled={!stripeConfigured && !settings.enabled}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="p-3.5 rounded-lg bg-card border border-border text-xs text-muted-foreground leading-relaxed">
            {settings.enabled ? (
              <p className="text-emerald-400 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                Payments &amp; POS is ACTIVE. Staff can process checkout for appointments, record cash/card payments, and issue receipts.
              </p>
            ) : (
              <p className="text-muted-foreground">
                <strong className="text-foreground">OFF Mode (Default):</strong> The shop operates in pay-at-shop mode. No credit card is required at booking, and staff manage transactions offline.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Staff & Barber Options */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-[var(--dash-brand)]" />
            Staff Checkout Permissions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium text-foreground">Allow Barbers to Perform Checkout</Label>
              <p className="text-xs text-muted-foreground">
                When enabled, barbers can access checkout for their own appointments and take cash or card payments.
              </p>
            </div>
            <Switch
              checked={settings.allowBarberCheckout}
              onCheckedChange={(checked) => setSettings({ ...settings, allowBarberCheckout: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Tip Settings */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-[var(--dash-brand)]" />
                Tips &amp; Gratuities
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Enable tipping options during checkout and set default percentage presets.
              </CardDescription>
            </div>
            <Switch
              checked={settings.tipsEnabled}
              onCheckedChange={(checked) => setSettings({ ...settings, tipsEnabled: checked })}
            />
          </div>
        </CardHeader>
        {settings.tipsEnabled && (
          <CardContent className="space-y-4 pt-2 border-t border-border/60">
            <div>
              <Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Tip Presets (%)
              </Label>
              <p className="text-xs text-muted-foreground mb-3">
                Quick selection buttons shown during checkout (maximum 6 presets).
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {settings.tipPresets.map((preset, idx) => (
                  <div key={idx} className="flex items-center gap-1 bg-card border border-border rounded-lg p-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={preset}
                      onChange={(e) => updatePreset(idx, Number(e.target.value))}
                      className="w-16 h-8 text-xs text-center font-mono font-bold bg-background border-border"
                    />
                    <span className="text-xs font-semibold text-muted-foreground">%</span>
                    {settings.tipPresets.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removePreset(idx)}
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
                {settings.tipPresets.length < 6 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addPreset}
                    className="h-9 border-dashed border-border text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Preset
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Tax Settings */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Percent className="w-4 h-4 text-[var(--dash-brand)]" />
                Sales Tax
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Apply local sales tax to services and checkout line items.
              </CardDescription>
            </div>
            <Switch
              checked={settings.taxEnabled}
              onCheckedChange={(checked) => setSettings({ ...settings, taxEnabled: checked })}
            />
          </div>
        </CardHeader>
        {settings.taxEnabled && (
          <CardContent className="pt-2 border-t border-border/60">
            <div className="max-w-xs space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Tax Rate (%)</Label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  max={50}
                  value={settings.taxRatePercent}
                  onChange={(e) => setSettings({ ...settings, taxRatePercent: Number(e.target.value) })}
                  className="bg-card border-border font-mono text-sm pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">%</span>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Deposits Settings */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-[var(--dash-brand)]" />
                Booking Deposits
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Require upfront deposit to lock in online appointments.
              </CardDescription>
            </div>
            <Switch
              checked={settings.depositsEnabled}
              onCheckedChange={(checked) => setSettings({ ...settings, depositsEnabled: checked })}
            />
          </div>
        </CardHeader>
        {settings.depositsEnabled && (
          <CardContent className="space-y-4 pt-2 border-t border-border/60">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Deposit Type</Label>
                <Select
                  value={settings.depositType}
                  onValueChange={(val: 'PERCENT' | 'FLAT') => setSettings({ ...settings, depositType: val })}
                >
                  <SelectTrigger className="bg-card border-border text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border">
                    <SelectItem value="PERCENT" className="text-xs">Percentage (%)</SelectItem>
                    <SelectItem value="FLAT" className="text-xs">Flat Dollar Amount ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Deposit Value</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step={settings.depositType === 'PERCENT' ? '1' : '0.01'}
                    min={0}
                    value={settings.depositValue}
                    onChange={(e) => setSettings({ ...settings, depositValue: Number(e.target.value) })}
                    className="bg-card border-border font-mono text-sm pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">
                    {settings.depositType === 'PERCENT' ? '%' : '$'}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Fee Policies: Cancellation & No-Show */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--dash-brand)]" />
            Cancellation &amp; No-Show Fee Policies
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground">
            Configure fee amounts for late cancellations and missed appointments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-3.5 rounded-lg bg-card border border-border space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground">Cancellation Fee</Label>
                <Switch
                  checked={settings.cancellationFeeEnabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, cancellationFeeEnabled: checked })}
                />
              </div>
              {settings.cancellationFeeEnabled && (
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Default Fee Amount ($)</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={settings.cancellationFeeAmount}
                    onChange={(e) => setSettings({ ...settings, cancellationFeeAmount: Number(e.target.value) })}
                    className="bg-background border-border font-mono text-xs"
                  />
                </div>
              )}
            </div>

            <div className="p-3.5 rounded-lg bg-card border border-border space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-foreground">No-Show Fee</Label>
                <Switch
                  checked={settings.noShowFeeEnabled}
                  onCheckedChange={(checked) => setSettings({ ...settings, noShowFeeEnabled: checked })}
                />
              </div>
              {settings.noShowFeeEnabled && (
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">Default Fee Amount ($)</span>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={settings.noShowFeeAmount}
                    onChange={(e) => setSettings({ ...settings, noShowFeeAmount: Number(e.target.value) })}
                    className="bg-background border-border font-mono text-xs"
                  />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Card on File, Receipts & Commission */}
      <Card className="bg-[var(--dash-surface)] border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
            <Receipt className="w-4 h-4 text-[var(--dash-brand)]" />
            Receipts, Cards on File &amp; Commission
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium text-foreground">Automatic Receipt Emails</Label>
              <p className="text-xs text-muted-foreground">Send digital payment receipts via email after checkout.</p>
            </div>
            <Switch
              checked={settings.receiptsEmailEnabled}
              onCheckedChange={(checked) => setSettings({ ...settings, receiptsEmailEnabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between border-t border-border/60 pt-3">
            <div>
              <Label className="text-sm font-medium text-foreground">Save Card on File</Label>
              <p className="text-xs text-muted-foreground">Allow customers to securely save payment cards for future visits.</p>
            </div>
            <Switch
              checked={settings.cardOnFileEnabled}
              onCheckedChange={(checked) => setSettings({ ...settings, cardOnFileEnabled: checked })}
            />
          </div>

          <div className="border-t border-border/60 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium text-foreground">Track Barber Commission</Label>
                <p className="text-xs text-muted-foreground">Calculate barber commission splits on service checkouts.</p>
              </div>
              <Switch
                checked={settings.commissionEnabled}
                onCheckedChange={(checked) => setSettings({ ...settings, commissionEnabled: checked })}
              />
            </div>

            {settings.commissionEnabled && (
              <div className="max-w-xs space-y-1.5 pt-1">
                <Label className="text-xs font-semibold text-foreground">Default Commission Rate (%)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.commissionRatePercent}
                    onChange={(e) => setSettings({ ...settings, commissionRatePercent: Number(e.target.value) })}
                    className="bg-card border-border font-mono text-sm pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">%</span>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
