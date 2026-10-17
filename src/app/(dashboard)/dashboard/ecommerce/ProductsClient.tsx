'use client'

/**
 * Ecommerce management client: storefront master switch + settings, product
 * catalog CRUD. All writes hit the session-scoped dashboard API (which
 * enforces tenant scoping + owner permission server-side).
 */
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { Package, Plus, RefreshCw, Save, ShoppingCart } from 'lucide-react'

interface ProductRow {
  id: string
  name: string
  slug: string
  description: string | null
  category: string | null
  productType: 'PHYSICAL' | 'DIGITAL'
  price: number
  compareAtPrice: number | null
  images: string[]
  published: boolean
  stock: number
  lowStockThreshold: number
  sku: string | null
  sortOrder: number
}

interface SettingsRow {
  enabled: boolean
  currency: string
  taxRatePercent: number
  shippingFlatRate: number
  freeShippingThreshold: number | null
  supportEmail: string | null
}

interface FormState {
  id?: string
  name: string
  slug: string
  description: string
  category: string
  productType: 'PHYSICAL' | 'DIGITAL'
  price: string
  compareAtPrice: string
  published: boolean
  stock: string
  sku: string
  sortOrder: string
}

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  description: '',
  category: '',
  productType: 'PHYSICAL',
  price: '',
  compareAtPrice: '',
  published: false,
  stock: '0',
  sku: '',
  sortOrder: '0',
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function formatPrice(n: number, currency: string) {
  const symbol = currency === 'USD' || currency === '' ? '$' : `${currency} `
  return `${symbol}${n.toFixed(2)}`
}

export function ProductsClient({
  initialProducts,
  initialSettings,
  featureEnabled,
}: {
  initialProducts: ProductRow[]
  initialSettings: SettingsRow
  featureEnabled: boolean
}) {
  const { toast } = useToast()
  const [products, setProducts] = useState(initialProducts)
  const [settings, setSettings] = useState(initialSettings)
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)

  const refresh = async () => {
    const res = await fetch('/api/dashboard/ecommerce/products')
    if (res.ok) {
      const data = (await res.json()) as { products: ProductRow[] }
      setProducts(data.products)
    }
  }

  const toggleStorefront = async (enabled: boolean) => {
    const res = await fetch('/api/dashboard/ecommerce/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (res.ok) {
      setSettings((s) => ({ ...s, enabled }))
      toast({ title: enabled ? 'Online store enabled' : 'Online store disabled' })
    } else {
      toast({ title: 'Could not update the store switch', variant: 'destructive' })
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/ecommerce/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxRatePercent: settings.taxRatePercent,
          shippingFlatRate: settings.shippingFlatRate,
          freeShippingThreshold: settings.freeShippingThreshold,
          supportEmail: settings.supportEmail || null,
          currency: settings.currency || undefined,
        }),
      })
      if (res.ok) {
        setSettingsDirty(false)
        toast({ title: 'Store settings saved' })
      } else {
        toast({ title: 'Could not save settings', variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (p: ProductRow) =>
    setForm({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description ?? '',
      category: p.category ?? '',
      productType: p.productType,
      price: String(p.price),
      compareAtPrice: p.compareAtPrice ? String(p.compareAtPrice) : '',
      published: p.published,
      stock: String(p.stock),
      sku: p.sku ?? '',
      sortOrder: String(p.sortOrder),
    })

  const saveProduct = async () => {
    if (!form) return
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        slug: form.slug || slugify(form.name),
        description: form.description || null,
        category: form.category || null,
        productType: form.productType,
        price: Number.parseFloat(form.price),
        compareAtPrice: form.compareAtPrice ? Number.parseFloat(form.compareAtPrice) : null,
        images: [],
        published: form.published,
        stock: form.stock === '' ? 0 : Number.parseInt(form.stock, 10),
        sku: form.sku || null,
        sortOrder: Number.parseInt(form.sortOrder || '0', 10),
      }
      const res = await fetch('/api/dashboard/ecommerce/products', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form.id ? { id: form.id, ...payload } : payload),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast({ title: data.error ?? 'Could not save the product', variant: 'destructive' })
        return
      }
      toast({ title: form.id ? 'Product updated' : 'Product created' })
      setForm(null)
      void refresh()
    } finally {
      setSaving(false)
    }
  }

  const togglePublished = async (p: ProductRow) => {
    const res = await fetch('/api/dashboard/ecommerce/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, published: !p.published }),
    })
    if (res.ok) {
      setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, published: !p.published } : x)))
    } else {
      toast({ title: 'Could not update the product', variant: 'destructive' })
    }
  }

  const unpublish = async (p: ProductRow) => {
    const res = await fetch(`/api/dashboard/ecommerce/products?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' })
    if (res.ok) {
      toast({ title: 'Product hidden from the shop' })
      void refresh()
    } else {
      toast({ title: 'Could not hide the product', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Online Shop</h1>
          <p className="text-sm text-muted-foreground">Products, storefront settings and orders.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link href="/dashboard/ecommerce/orders">
              <ShoppingCart className="h-4 w-4" aria-hidden /> Orders
            </Link>
          </Button>
          <Button className="gap-2" onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus className="h-4 w-4" aria-hidden /> New product
          </Button>
        </div>
      </div>

      {!featureEnabled && (
        <Card className="border-amber-500/40">
          <CardContent className="p-4 text-sm">
            The <strong>ecommerce feature flag</strong> is off for this shop — the storefront stays
            hidden even with the master switch enabled. Enable it in Settings → Features.
          </CardContent>
        </Card>
      )}

      {/* ─── Storefront settings ─── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Package className="h-5 w-5" aria-hidden /> Storefront
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Online store</p>
              <p className="text-sm text-muted-foreground">
                {settings.enabled
                  ? 'Your public shop is live at /shop.'
                  : 'Hidden from the storefront until enabled.'}
              </p>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={toggleStorefront}
              aria-label="Toggle online store"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="tax-rate">Tax rate (%)</Label>
              <Input
                id="tax-rate"
                type="number"
                min={0}
                max={100}
                step="0.01"
                value={settings.taxRatePercent}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, taxRatePercent: Number.parseFloat(e.target.value) || 0 }))
                  setSettingsDirty(true)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="shipping-rate">Flat shipping rate</Label>
              <Input
                id="shipping-rate"
                type="number"
                min={0}
                step="0.01"
                value={settings.shippingFlatRate}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, shippingFlatRate: Number.parseFloat(e.target.value) || 0 }))
                  setSettingsDirty(true)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="free-shipping">Free shipping above (blank = never)</Label>
              <Input
                id="free-shipping"
                type="number"
                min={0}
                step="0.01"
                value={settings.freeShippingThreshold ?? ''}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, freeShippingThreshold: e.target.value === '' ? null : Number.parseFloat(e.target.value) }))
                  setSettingsDirty(true)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-email">Support email (blank = shop email)</Label>
              <Input
                id="support-email"
                type="email"
                value={settings.supportEmail ?? ''}
                onChange={(e) => {
                  setSettings((s) => ({ ...s, supportEmail: e.target.value }))
                  setSettingsDirty(true)
                }}
              />
            </div>
          </div>
          {settingsDirty && (
            <Button onClick={saveSettings} disabled={saving} className="gap-2">
              <Save className="h-4 w-4" aria-hidden /> Save settings
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ─── Product form ─── */}
      {form && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{form.id ? `Edit: ${form.name}` : 'New product'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="p-name">Name</Label>
                <Input
                  id="p-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: f.id ? f.slug : slugify(e.target.value) }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-slug">Slug (URL)</Label>
                <Input id="p-slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-price">Price</Label>
                <Input id="p-price" type="number" min={0.01} step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-compare">Compare-at price (optional)</Label>
                <Input id="p-compare" type="number" min={0.01} step="0.01" value={form.compareAtPrice} onChange={(e) => setForm((f) => ({ ...f, compareAtPrice: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-type">Type</Label>
                <select
                  id="p-type"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.productType}
                  onChange={(e) => setForm((f) => ({ ...f, productType: e.target.value as 'PHYSICAL' | 'DIGITAL' }))}
                >
                  <option value="PHYSICAL">Physical</option>
                  <option value="DIGITAL">Digital download</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-stock">Stock (-1 = untracked)</Label>
                <Input id="p-stock" type="number" min={-1} value={form.stock} onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-category">Category (optional)</Label>
                <Input id="p-category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="p-sku">SKU (optional)</Label>
                <Input id="p-sku" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="p-description">Description</Label>
                <Textarea id="p-description" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="flex items-center gap-2 md:col-span-2">
                <Switch
                  id="p-published"
                  checked={form.published}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, published: v }))}
                />
                <Label htmlFor="p-published">Published (visible in the shop)</Label>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={saveProduct} disabled={saving || !form.name || !form.price}>
                {saving ? 'Saving…' : form.id ? 'Save changes' : 'Create product'}
              </Button>
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Product list ─── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Products ({products.length})</CardTitle>
          <Button variant="ghost" size="icon" aria-label="Refresh products" onClick={() => void refresh()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Button>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products yet — create your first one.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Product</th>
                    <th className="pb-2 pr-4 font-medium">Price</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Stock</th>
                    <th className="pb-2 pr-4 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-3 pr-4">
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.slug}{p.sku ? ` · ${p.sku}` : ''}</p>
                      </td>
                      <td className="py-3 pr-4">{formatPrice(p.price, settings.currency)}</td>
                      <td className="py-3 pr-4">{p.productType === 'DIGITAL' ? 'Digital' : 'Physical'}</td>
                      <td className="py-3 pr-4">
                        {p.stock === -1 ? (
                          <span className="text-muted-foreground">Untracked</span>
                        ) : (
                          <span className={p.stock <= p.lowStockThreshold ? 'text-amber-600 font-medium' : ''}>
                            {p.stock}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        {p.published ? <Badge>Live</Badge> : <Badge variant="outline">Hidden</Badge>}
                      </td>
                      <td className="py-3 text-right space-x-2 whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => void togglePublished(p)}>
                          {p.published ? 'Hide' : 'Publish'}
                        </Button>
                        {p.published && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => void unpublish(p)}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
