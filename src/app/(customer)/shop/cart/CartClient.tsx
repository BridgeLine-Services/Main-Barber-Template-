'use client'

/**
 * Cart review. Quantities update the localStorage cart; the subtotal is
 * display-only and the checkout endpoint always recomputes prices.
 */
import { useCallback, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  EMPTY_CART,
  getCartSnapshot,
  removeFromCart,
  subscribeCart,
  setQuantity,
} from '@/lib/shop/cart'
import { ArrowRight, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react'

function formatPrice(n: number) {
  return `$${n.toFixed(2)}`
}

export function CartClient({ slug, enabled }: { slug: string; enabled: boolean }) {
  const items = useSyncExternalStore(
    useCallback((cb) => subscribeCart(slug, cb), [slug]),
    () => getCartSnapshot(slug),
    () => EMPTY_CART
  )
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const ready = true

  if (!enabled) {
    return (
      <div className="text-center">
        <h1 className="display-heading text-display-3">Cart</h1>
        <p className="mt-2 text-muted-foreground">The online shop is not available right now.</p>
      </div>
    )
  }

  if (!ready) return null

  if (items.length === 0) {
    return (
      <div className="text-center">
        <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground/50" aria-hidden />
        <h1 className="mt-4 display-heading text-display-3">Your cart is empty</h1>
        <p className="mt-2 text-muted-foreground">Browse the shop and add something you like.</p>
        <Button asChild className="mt-6">
          <Link href="/shop">Back to the shop</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="display-heading text-display-3 mb-8">Your cart</h1>
      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.productId}>
            <CardContent className="flex items-center gap-4 p-4">
              {item.image ? (
                <img src={item.image} alt={item.name} className="h-16 w-16 rounded-lg object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted" aria-hidden>
                  <ShoppingBag className="h-6 w-6 text-muted-foreground/50" />
                </div>
              )}
              <div className="flex-1">
                <p className="font-medium leading-tight">{item.name}</p>
                <p className="text-sm text-muted-foreground">{formatPrice(item.price)} each</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Decrease ${item.name} quantity`}
                  onClick={() => setQuantity(slug, item.productId, item.quantity - 1)}
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </Button>
                <span className="w-8 text-center font-medium">{item.quantity}</span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={`Increase ${item.name} quantity`}
                  onClick={() => setQuantity(slug, item.productId, item.quantity + 1)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <p className="w-20 text-right font-semibold">{formatPrice(item.price * item.quantity)}</p>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove ${item.name} from cart`}
                onClick={() => removeFromCart(slug, item.productId)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal (before tax/shipping)</span>
          <span className="text-base font-semibold">{formatPrice(subtotal)}</span>
        </CardContent>
        <CardFooter>
          <Button asChild className="w-full gap-2">
            <Link href="/shop/checkout">
              Continue to checkout <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
