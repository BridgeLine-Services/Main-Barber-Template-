/**
 * Storefront cart — client-side, per-business, localStorage-backed.
 *
 * Design notes:
 *   - The cart is keyed by business slug: a visitor browsing two different
 *     shops (tenants) on the same browser NEVER shares cart contents.
 *   - Prices in the cart are DISPLAY-ONLY. Every total is recomputed
 *     server-side at checkout from the authoritative catalog (createOrder);
 *     a tampered localStorage cart cannot change what a customer is charged.
 *   - Stock shown per line is a snapshot from page render; the server
 *     revalidates stock atomically at checkout.
 *   - All state changes dispatch the 'shopcart' event so open components
 *     (badge, cart page) re-render without a framework store.
 */

export interface CartItem {
  productId: string
  name: string
  price: number // display only; server recomputes
  productType: 'PHYSICAL' | 'DIGITAL'
  image: string | null
  inStock: boolean // snapshot at add time
  quantity: number
}

const MAX_QTY_PER_LINE = 100

function key(slug: string): string {
  return `shopCart:${slug}`
}

export function getCart(slug: string): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key(slug))
    if (!raw) return []
    const parsed = JSON.parse(raw) as CartItem[]
    if (!Array.isArray(parsed)) return []
    // Defensive: only keep well-formed rows a tampered store cannot abuse.
    return parsed.filter(
      (i) =>
        typeof i?.productId === 'string' &&
        typeof i.name === 'string' &&
        typeof i.price === 'number' &&
        Number.isFinite(i.price) &&
        typeof i.quantity === 'number' &&
        i.quantity > 0
    )
  } catch {
    return []
  }
}

function write(slug: string, items: CartItem[]) {
  window.localStorage.setItem(key(slug), JSON.stringify(items))
  window.dispatchEvent(new CustomEvent('shopcart', { detail: { slug } }))
}

export function addToCart(slug: string, item: Omit<CartItem, 'quantity'>, quantity = 1) {
  const items = getCart(slug)
  const existing = items.find((i) => i.productId === item.productId)
  if (existing) {
    existing.quantity = Math.min(existing.quantity + quantity, MAX_QTY_PER_LINE)
    // refresh display-only fields from the current catalog entry
    existing.name = item.name
    existing.price = item.price
    existing.inStock = item.inStock
    existing.image = item.image
  } else {
    items.push({ ...item, quantity: Math.min(quantity, MAX_QTY_PER_LINE) })
  }
  write(slug, items)
}

export function setQuantity(slug: string, productId: string, quantity: number) {
  if (quantity <= 0) return removeFromCart(slug, productId)
  const items = getCart(slug)
  const existing = items.find((i) => i.productId === productId)
  if (!existing) return
  existing.quantity = Math.min(Math.floor(quantity), MAX_QTY_PER_LINE)
  write(slug, items)
}

export function removeFromCart(slug: string, productId: string) {
  write(
    slug,
    getCart(slug).filter((i) => i.productId !== productId)
  )
}

export function clearCart(slug: string) {
  write(slug, [])
}

export function cartCount(slug: string): number {
  return getCart(slug).reduce((sum, i) => sum + i.quantity, 0)
}

/** Display-only subtotal — the charged total is always computed server-side. */
export function cartSubtotal(slug: string): number {
  return getCart(slug).reduce((sum, i) => sum + i.price * i.quantity, 0)
}

/** Checkout payload lines (ids + quantities only — never client prices). */
export function cartLines(slug: string): { productId: string; quantity: number }[] {
  return getCart(slug).map((i) => ({ productId: i.productId, quantity: i.quantity }))
}

export function cartHasPhysical(slug: string): boolean {
  return getCart(slug).some((i) => i.productType === 'PHYSICAL')
}

// ─── useSyncExternalStore plumbing ────────────────────────────────────────────
// React 18 external-store subscription so components read the cart without
// setState-in-effect (SSR-safe: server snapshot is always empty).

export const EMPTY_CART: CartItem[] = []

/** Per-slug snapshot cache: stable object identity between identical reads. */
const snapshotCache = new Map<string, { raw: string | null; items: CartItem[] }>()

export function getCartSnapshot(slug: string): CartItem[] {
  const raw = window.localStorage.getItem(key(slug))
  const cached = snapshotCache.get(slug)
  if (cached && cached.raw === raw) return cached.items
  const items = getCart(slug)
  snapshotCache.set(slug, { raw, items })
  return items
}

/** Subscribe to cart changes (custom event + cross-tab storage writes). */
export function subscribeCart(slug: string, onChange: () => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ slug?: string }>).detail
    if (!detail?.slug || detail.slug === slug) onChange()
  }
  const storage = (e: StorageEvent) => {
    if (e.key === key(slug)) onChange()
  }
  window.addEventListener('shopcart', handler)
  window.addEventListener('storage', storage)
  return () => {
    window.removeEventListener('shopcart', handler)
    window.removeEventListener('storage', storage)
  }
}
