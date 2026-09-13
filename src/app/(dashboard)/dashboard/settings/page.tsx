'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'
import {
  Save, Building2, Phone, Mail, MapPin, Clock, Globe, Palette, Users,
  Search, FileText, Image as ImageIcon, Check, HelpCircle
} from 'lucide-react'
import { FaqManager } from '@/components/dashboard/FaqManager'
import { resolveBusinessTimezone } from '@/lib/timezone'

const TIMEZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

const FONTS = [
  { label: 'Default (System)', value: '' },
  { label: 'Poppins', value: 'poppins' },
  { label: 'Inter', value: 'inter' },
  { label: 'Montserrat', value: 'montserrat' },
]

const DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]

const DEFAULT_HOURS: Record<string, { open: string; close: string; isOff: boolean }> = {
  monday: { open: '09:00', close: '18:00', isOff: false },
  tuesday: { open: '09:00', close: '18:00', isOff: false },
  wednesday: { open: '09:00', close: '18:00', isOff: false },
  thursday: { open: '09:00', close: '18:00', isOff: false },
  friday: { open: '09:00', close: '18:00', isOff: false },
  saturday: { open: '09:00', close: '16:00', isOff: false },
  sunday: { open: '09:00', close: '16:00', isOff: true },
}

type Tab = 'business' | 'hours' | 'branding' | 'social' | 'policies' | 'seo' | 'faq' | 'website' | 'booking'

export default function SettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [business, setBusiness] = useState<any>(null)
  const [seo, setSeo] = useState<any>(null)
  const [websiteContent, setWebsiteContent] = useState<any>({})
  const [bookingQuestions, setBookingQuestions] = useState<any[]>([])
  const [newQuestion, setNewQuestion] = useState({ label: '', key: '', type: 'SHORT_TEXT', required: false })
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'business')

  useEffect(() => {
    fetch('/api/dashboard/settings')
      .then(r => r.json())
      .then(data => {
        setBusiness(data.business)
        setSeo(data.seo || {})
        setWebsiteContent(data.websiteContent || {})
        setBookingQuestions(data.bookingQuestions || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...business, seo, websiteContent }),
      })
      const data = await res.json()
      if (data.business) {
        setBusiness(data.business)
        if (data.seo) setSeo(data.seo)
        toast({ title: 'Settings saved successfully' })
      } else {
        toast({ title: 'Failed to save', description: data.error, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Failed to save settings', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Update hours for a specific day
  const updateHours = (day: string, field: 'open' | 'close' | 'isOff', value: string | boolean) => {
    const currentHours = business.hours || DEFAULT_HOURS
    const updated = {
      ...currentHours,
      [day]: { ...currentHours[day], [field]: value },
    }
    setBusiness({ ...business, hours: updated })
  }

  // Copy weekday hours to all days
  const copyWeekdays = () => {
    const weekday = business.hours?.monday || DEFAULT_HOURS.monday
    const updated: any = {}
    DAYS.forEach(d => {
      updated[d.key] = d.key === 'sunday' || d.key === 'saturday'
        ? { ...weekday, isOff: true }
        : { ...weekday }
    })
    setBusiness({ ...business, hours: updated })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-zinc-400">Loading settings...</p>
      </div>
    )
  }

  if (!business) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-zinc-400">No business data found.</p>
          <p className="text-sm text-zinc-500">Run the seed script to create a business.</p>
        </div>
      </div>
    )
  }

  const tabs: { id: Tab; label: string; icon: typeof Building2 }[] = [
    { id: 'business', label: 'Business Info', icon: Building2 },
    { id: 'hours', label: 'Business Hours', icon: Clock },
    { id: 'branding', label: 'Branding & Theme', icon: Palette },
    { id: 'social', label: 'Social Links', icon: Globe },
    { id: 'policies', label: 'Policies', icon: FileText },
    { id: 'seo', label: 'SEO', icon: Search },
    { id: 'faq', label: 'FAQ', icon: HelpCircle },
    { id: 'website', label: 'Website Content', icon: FileText },
    { id: 'booking', label: 'Booking Questions', icon: HelpCircle },
  ]

  const addBookingQuestion = async () => {
    if (!newQuestion.label.trim() || !newQuestion.key.trim()) return
    const response = await fetch('/api/dashboard/booking-questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newQuestion) })
    const data = await response.json()
    if (response.ok) {
      setBookingQuestions((current) => [...current, data.question])
      setNewQuestion({ label: '', key: '', type: 'SHORT_TEXT', required: false })
      toast({ title: 'Booking question added' })
    } else toast({ title: 'Could not add question', description: data.error, variant: 'destructive' })
  }

  const hours = business.hours || DEFAULT_HOURS

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Business Settings</h1>
          <p className="text-sm text-zinc-400 mt-1">Manage your shop information, branding, hours, policies, and SEO.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-amber-500 text-black hover:bg-amber-400">
          <Save className="mr-2 h-4 w-4" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-800 pb-2">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* ── Business Info ── */}
      {activeTab === 'business' && (
        <>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-amber-500" />
                Business Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-zinc-400">Shop Name</Label>
                  <Input
                    value={business.name || ''}
                    onChange={e => setBusiness({ ...business, name: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400">Timezone</Label>
                  <select
                    value={resolveBusinessTimezone(business)}
                    onChange={e => setBusiness({ ...business, timezone: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white text-sm"
                  >
                    {TIMEZONES.map(tz => (
                      <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <Label className="text-zinc-400">About Text</Label>
                <Textarea
                  value={business.aboutText || ''}
                  onChange={e => setBusiness({ ...business, aboutText: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1 min-h-[100px]"
                  placeholder="Tell customers about your shop..."
                />
              </div>
            </CardContent>
          </Card>

          {/* Team Section Content — configurable text for the /barbers page */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5 text-amber-500" />
                Meet the Team Section
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-zinc-400">Section Label (badge text)</Label>
                <Input
                  value={business.teamSectionLabel || ''}
                  onChange={e => setBusiness({ ...business, teamSectionLabel: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="Our Team"
                />
                <p className="text-xs text-zinc-500 mt-1">Small badge shown above the heading on the Barbers page</p>
              </div>
              <div>
                <Label className="text-zinc-400">Section Title</Label>
                <Input
                  value={business.teamSectionTitle || ''}
                  onChange={e => setBusiness({ ...business, teamSectionTitle: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder={`Meet the Barbers at ${business.name || 'Your Shop'}`}
                />
                <p className="text-xs text-zinc-500 mt-1">Main heading. Leave blank to auto-use "Meet the Barbers at [Shop Name]"</p>
              </div>
              <div>
                <Label className="text-zinc-400">Section Description</Label>
                <Textarea
                  value={business.teamSectionDescription || ''}
                  onChange={e => setBusiness({ ...business, teamSectionDescription: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1 min-h-[80px]"
                  placeholder="Each member of our team brings years of experience, attention to detail, and passion for precision cuts and classic grooming."
                />
                <p className="text-xs text-zinc-500 mt-1">Paragraph shown below the heading. Leave blank for default text.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Phone className="h-5 w-5 text-amber-500" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-zinc-400">Phone</Label>
                  <Input
                    value={business.phone || ''}
                    onChange={e => setBusiness({ ...business, phone: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 mt-1"
                    placeholder="(555) 555-0199"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400">Email</Label>
                  <Input
                    type="email"
                    value={business.email || ''}
                    onChange={e => setBusiness({ ...business, email: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 mt-1"
                    placeholder="shop@example.com"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MapPin className="h-5 w-5 text-amber-500" />
                Location
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-zinc-400">Street Address</Label>
                <Input
                  value={business.address || ''}
                  onChange={e => setBusiness({ ...business, address: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label className="text-zinc-400">City</Label>
                  <Input
                    value={business.city || ''}
                    onChange={e => setBusiness({ ...business, city: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400">State</Label>
                  <Input
                    value={business.state || ''}
                    onChange={e => setBusiness({ ...business, state: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 mt-1"
                  />
                </div>
                <div>
                  <Label className="text-zinc-400">ZIP</Label>
                  <Input
                    value={business.zipCode || ''}
                    onChange={e => setBusiness({ ...business, zipCode: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 mt-1"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Business Hours ── */}
      {activeTab === 'hours' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5 text-amber-500" />
                Weekly Business Hours
              </CardTitle>
              <Button
                onClick={copyWeekdays}
                variant="outline"
                size="sm"
                className="border-zinc-700 text-zinc-300 text-xs"
              >
                Copy Mon to All Weekdays
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-500">
              Set your shop&apos;s operating hours. These are shown to customers and used for booking availability.
            </p>
            {DAYS.map(day => {
              const dayHours = hours[day.key] || { open: '09:00', close: '18:00', isOff: false }
              return (
                <div key={day.key} className="flex items-center gap-4 py-2 border-b border-zinc-800 last:border-0">
                  <div className="w-28 shrink-0">
                    <Label className="text-zinc-200 font-medium">{day.label}</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!dayHours.isOff}
                      onCheckedChange={(v: boolean) => updateHours(day.key, 'isOff', !v)}
                    />
                    <span className="text-xs text-zinc-500 w-12">
                      {dayHours.isOff ? 'Closed' : 'Open'}
                    </span>
                  </div>
                  {!dayHours.isOff && (
                    <div className="flex items-center gap-2 ml-auto">
                      <Input
                        type="time"
                        value={dayHours.open || '09:00'}
                        onChange={e => updateHours(day.key, 'open', e.target.value)}
                        className="bg-zinc-800 border-zinc-700 w-32 text-sm"
                      />
                      <span className="text-zinc-500">—</span>
                      <Input
                        type="time"
                        value={dayHours.close || '18:00'}
                        onChange={e => updateHours(day.key, 'close', e.target.value)}
                        className="bg-zinc-800 border-zinc-700 w-32 text-sm"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* ── Branding & Theme ── */}
      {activeTab === 'branding' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Palette className="h-5 w-5 text-amber-500" />
              Branding & Theme
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Logo */}
            <div>
              <Label className="text-zinc-400">Logo URL</Label>
              <Input
                value={business.logo || ''}
                onChange={e => setBusiness({ ...business, logo: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="https://..."
              />
              {business.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logo} alt="Logo preview" className="mt-2 h-16 rounded-lg border border-zinc-700 bg-zinc-800 p-2" />
              )}
            </div>

            {/* Colors */}
            <div className="space-y-4">
              <div>
                <Label className="text-zinc-400">Primary Color (Background)</Label>
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="color"
                    value={business.primaryColor || '#1a1a1a'}
                    onChange={e => setBusiness({ ...business, primaryColor: e.target.value })}
                    className="h-10 w-14 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                  />
                  <Input
                    value={business.primaryColor || ''}
                    onChange={e => setBusiness({ ...business, primaryColor: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 max-w-[160px]"
                  />
                </div>
              </div>
              <div>
                <Label className="text-zinc-400">Accent Color</Label>
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="color"
                    value={business.accentColor || '#d4af37'}
                    onChange={e => setBusiness({ ...business, accentColor: e.target.value })}
                    className="h-10 w-14 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                  />
                  <Input
                    value={business.accentColor || ''}
                    onChange={e => setBusiness({ ...business, accentColor: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 max-w-[160px]"
                  />
                </div>
              </div>
              <div>
                <Label className="text-zinc-400">Secondary Surface Color</Label>
                <div className="flex items-center gap-3 mt-1">
                  <input
                    type="color"
                    value={business.secondaryColor || '#2a2a2a'}
                    onChange={e => setBusiness({ ...business, secondaryColor: e.target.value })}
                    className="h-10 w-14 rounded border border-zinc-700 bg-zinc-800 cursor-pointer"
                  />
                  <Input
                    value={business.secondaryColor || ''}
                    onChange={e => setBusiness({ ...business, secondaryColor: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 max-w-[160px]"
                  />
                </div>
              </div>
            </div>

            {/* Theme mode */}
            <div>
              <Label className="text-zinc-400">Theme Mode</Label>
              <select
                value={business.themeMode || 'dark'}
                onChange={e => setBusiness({ ...business, themeMode: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white text-sm"
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </div>

            {/* Font */}
            <div>
              <Label className="text-zinc-400">Font Family</Label>
              <select
                value={business.fontFamily || ''}
                onChange={e => setBusiness({ ...business, fontFamily: e.target.value })}
                className="w-full mt-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-white text-sm"
              >
                {FONTS.map(f => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {/* Preview */}
            <div className="rounded-lg border border-zinc-700 p-4" style={{ background: business.primaryColor || '#1a1a1a' }}>
              <p className="text-xs text-zinc-500 mb-2">Theme Preview:</p>
              <div className="flex items-center gap-3">
                <span style={{ color: business.accentColor || '#d4af37' }} className="text-lg font-bold">
                  Sample Heading
                </span>
                <button
                  className="px-3 py-1 rounded text-sm font-medium"
                  style={{ background: business.accentColor || '#d4af37', color: business.primaryColor || '#1a1a1a' }}
                >
                  Button
                </button>
              </div>
              <p className="text-sm mt-2" style={{ color: '#a0a0a0' }}>
                Body text on the primary surface.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Social Links ── */}
      {activeTab === 'social' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Globe className="h-5 w-5 text-amber-500" />
              Social Media Links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-zinc-400">Instagram</Label>
              <Input
                value={business.instagram || ''}
                onChange={e => setBusiness({ ...business, instagram: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="@yourshop"
              />
            </div>
            <div>
              <Label className="text-zinc-400">Facebook</Label>
              <Input
                value={business.facebook || ''}
                onChange={e => setBusiness({ ...business, facebook: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="facebook.com/yourshop"
              />
            </div>
            <div>
              <Label className="text-zinc-400">TikTok</Label>
              <Input
                value={business.tiktok || ''}
                onChange={e => setBusiness({ ...business, tiktok: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="@yourshop"
              />
            </div>
            <div>
              <Label className="text-zinc-400">YouTube</Label>
              <Input
                value={business.youtube || ''}
                onChange={e => setBusiness({ ...business, youtube: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="youtube.com/@yourshop"
              />
            </div>
            <div>
              <Label className="text-zinc-400">X (Twitter)</Label>
              <Input
                value={business.xTwitter || ''}
                onChange={e => setBusiness({ ...business, xTwitter: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="@yourshop"
              />
            </div>
            <div>
              <Label className="text-zinc-400">Google Business Profile URL</Label>
              <Input
                value={business.googleBusinessProfile || ''}
                onChange={e => setBusiness({ ...business, googleBusinessProfile: e.target.value })}
                className="bg-zinc-800 border-zinc-700 mt-1"
                placeholder="https://business.google.com/..."
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Policies ── */}
      {activeTab === 'policies' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-amber-500" />
              Shop Policies
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { field: 'bookingPolicy', label: 'Booking Policy', placeholder: 'Rules for booking appointments...' },
              { field: 'cancellationPolicy', label: 'Cancellation Policy', placeholder: 'Cancellation rules and timeframes...' },
              { field: 'latePolicy', label: 'Late Policy', placeholder: 'Late arrival policy...' },
              { field: 'noShowPolicyText', label: 'No-Show Policy', placeholder: 'No-show consequences...' },
              { field: 'paymentPolicy', label: 'Payment Policy', placeholder: 'Payment methods and terms...' },
              { field: 'privacyPolicy', label: 'Privacy Policy', placeholder: 'How customer data is handled...' },
              { field: 'termsPolicy', label: 'Terms of Service', placeholder: 'Terms and conditions...' },
            ].map(p => (
              <div key={p.field}>
                <Label className="text-zinc-400">{p.label}</Label>
                <Textarea
                  value={business[p.field] || ''}
                  onChange={e => setBusiness({ ...business, [p.field]: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1 min-h-[80px]"
                  placeholder={p.placeholder}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── SEO ── */}
      {activeTab === 'seo' && (
        <>
          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Search className="h-5 w-5 text-amber-500" />
                Search Engine Optimization
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-zinc-400">Site Title</Label>
                <Input
                  value={seo?.siteTitle || ''}
                  onChange={e => setSeo({ ...seo, siteTitle: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="Custom title for search engines (defaults to shop name)"
                />
                <p className="text-xs text-zinc-500 mt-1">Shown in browser tab and search results. Keep under 60 characters.</p>
              </div>
              <div>
                <Label className="text-zinc-400">Site Description (Meta Description)</Label>
                <Textarea
                  value={seo?.siteDescription || ''}
                  onChange={e => setSeo({ ...seo, siteDescription: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1 min-h-[80px]"
                  placeholder="Brief description of your shop for search results..."
                />
                <p className="text-xs text-zinc-500 mt-1">Keep under 160 characters for best results.</p>
              </div>
              <div>
                <Label className="text-zinc-400">Keywords</Label>
                <Input
                  value={seo?.keywords || ''}
                  onChange={e => setSeo({ ...seo, keywords: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="barber, haircut, fade, beard trim, ..."
                />
                <p className="text-xs text-zinc-500 mt-1">Comma-separated keywords relevant to your shop.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ImageIcon className="h-5 w-5 text-amber-500" />
                Open Graph (Social Sharing)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-zinc-400">OG Title</Label>
                <Input
                  value={seo?.ogTitle || ''}
                  onChange={e => setSeo({ ...seo, ogTitle: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="Title shown when sharing on social media"
                />
              </div>
              <div>
                <Label className="text-zinc-400">OG Description</Label>
                <Textarea
                  value={seo?.ogDescription || ''}
                  onChange={e => setSeo({ ...seo, ogDescription: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1 min-h-[60px]"
                  placeholder="Description shown when sharing on social media"
                />
              </div>
              <div>
                <Label className="text-zinc-400">OG Image URL</Label>
                <Input
                  value={seo?.ogImage || ''}
                  onChange={e => setSeo({ ...seo, ogImage: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="https://... (recommended 1200x630px)"
                />
                {seo?.ogImage && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={seo.ogImage} alt="OG preview" className="mt-2 max-w-sm rounded-lg border border-zinc-700" />
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Globe className="h-5 w-5 text-amber-500" />
                Robots & Verification
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-zinc-200">Allow Search Engine Indexing</Label>
                  <p className="text-xs text-zinc-500 mt-1">Allow Google, Bing, etc. to index your site</p>
                </div>
                <Switch
                  checked={seo?.robotsIndex !== false}
                  onCheckedChange={(v: boolean) => setSeo({ ...seo, robotsIndex: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-zinc-200">Allow Search Engine Following</Label>
                  <p className="text-xs text-zinc-500 mt-1">Allow crawlers to follow links on your site</p>
                </div>
                <Switch
                  checked={seo?.robotsFollow !== false}
                  onCheckedChange={(v: boolean) => setSeo({ ...seo, robotsFollow: v })}
                />
              </div>
              <div>
                <Label className="text-zinc-400">Canonical URL</Label>
                <Input
                  value={seo?.canonicalUrl || ''}
                  onChange={e => setSeo({ ...seo, canonicalUrl: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="https://yourshop.com"
                />
                <p className="text-xs text-zinc-500 mt-1">The preferred URL for search engines (prevents duplicate content issues).</p>
              </div>
              <div>
                <Label className="text-zinc-400">Google Search Console Verification</Label>
                <Input
                  value={seo?.googleVerification || ''}
                  onChange={e => setSeo({ ...seo, googleVerification: e.target.value })}
                  className="bg-zinc-800 border-zinc-700 mt-1"
                  placeholder="google-site-verification=..."
                />
                <p className="text-xs text-zinc-500 mt-1">From Google Search Console &gt; Settings &gt; HTML tag verification.</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

  {activeTab === 'faq' && <FaqManager />}

      {activeTab === 'website' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle>Website Content</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-zinc-400">Control the public homepage copy without changing the booking system.</p>
            {[
              ['heroEyebrow', 'Hero eyebrow'], ['heroTitle', 'Hero title'], ['heroDescription', 'Hero description'],
              ['servicesTitle', 'Services heading'], ['teamTitle', 'Team heading'], ['reviewsTitle', 'Reviews heading'],
              ['finalCtaTitle', 'Final call-to-action heading'],
            ].map(([key, label]) => (
              <div key={key} className="flex flex-col gap-1">
                <Label className="text-zinc-400">{label}</Label>
                {key.toLowerCase().includes('description') ? (
                  <Textarea value={websiteContent[key] || ''} onChange={e => setWebsiteContent({ ...websiteContent, [key]: e.target.value })} className="bg-zinc-800 border-zinc-700" />
                ) : (
                  <Input value={websiteContent[key] || ''} onChange={e => setWebsiteContent({ ...websiteContent, [key]: e.target.value })} className="bg-zinc-800 border-zinc-700" />
                )}
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              {(['showServices', 'showTeam', 'showReviews', 'showVisit', 'showFaq', 'showFinalCta'] as const).map(key => (
                <label key={key} className="flex items-center gap-2 text-sm text-zinc-300">
                  <Switch checked={websiteContent[key] !== false} onCheckedChange={checked => setWebsiteContent({ ...websiteContent, [key]: checked })} />
                  {key.replace('show', 'Show ')}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {activeTab === 'booking' && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle>Booking Questions</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-zinc-400">Add the questions customers should answer before confirming a booking.</p>
            <div className="grid gap-3 rounded-lg border border-zinc-800 p-4 sm:grid-cols-2">
              <Input placeholder="Question label" value={newQuestion.label} onChange={(event) => setNewQuestion({ ...newQuestion, label: event.target.value })} />
              <Input placeholder="Internal key, e.g. hair_goal" value={newQuestion.key} onChange={(event) => setNewQuestion({ ...newQuestion, key: event.target.value })} />
              <select value={newQuestion.type} onChange={(event) => setNewQuestion({ ...newQuestion, type: event.target.value })} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"><option value="SHORT_TEXT">Short text</option><option value="LONG_TEXT">Long text</option><option value="YES_NO">Yes / No</option><option value="SINGLE_CHOICE">Single choice</option><option value="MULTIPLE_CHOICE">Multiple choice</option><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="DATE">Date</option></select>
              <label className="flex items-center gap-2 text-sm text-zinc-300"><input type="checkbox" checked={newQuestion.required} onChange={(event) => setNewQuestion({ ...newQuestion, required: event.target.checked })} /> Required</label>
              <Button type="button" onClick={addBookingQuestion} className="sm:col-span-2">Add question</Button>
            </div>
            {bookingQuestions.length === 0 ? <p className="text-sm text-zinc-500">No custom questions yet.</p> : bookingQuestions.map(question => <div key={question.id} className="flex items-center justify-between rounded-lg border border-zinc-800 p-3"><div><p className="font-medium text-zinc-200">{question.label}</p><p className="text-xs text-zinc-500">{question.type}{question.required ? ' · Required' : ''}</p></div><Badge variant={question.isActive ? 'default' : 'secondary'}>{question.isActive ? 'Active' : 'Archived'}</Badge></div>)}
          </CardContent>
        </Card>
      )}
  </div>
  )
}
