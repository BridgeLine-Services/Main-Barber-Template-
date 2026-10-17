'use client'

/**
 * Public storefront catalog (client). Cart lives in localStorage per
 * business slug — prices here are display-only; checkout recomputes
 * everything server-side.
 */
import { useCallback, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { Section, SectionHeading } from '@/components/customer/Section'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { addToCart, EMPTY_CART, getCartSnapshot, subscribeCart } from '@/lib/shop/cart'
import type { PublicProduct } from '@/lib/ecommerce'
import { Check, ShoppingBag } from 'lucide-react'

function formatPrice(n: number) {
  return `$${n.toFixed(2)}`
}

export function ShopClient({
  slug,
  shopName,
  products,
}: {
  slug: string
  shopName: string
  products: PublicProduct[]
}) {
  const [justAdded, setJustAdded] = useState<string | null>(null)
  const itemsInCart = useSyncExternalStore(
    useCallback((cb) => subscribeCart(slug, cb), [slug]),
    () => getCartSnapshot(slug),
    () => EMPTY_CART
  )
  const count = itemsInCart.reduce((sum, i) => sum + i.quantity, 0)

  const add = (p: PublicProduct) => {
    addToCart(slug, {
      productId: p.id,
      name: p.name,
      price: p.price,
      productType: p.productType,
      image: p.images[0] ?? null,
      inStock: p.inStock,
    })
    setJustAdded(p.id)
    window.setTimeout(() => setJustAdded(null), 1200)
  }

  return (
    <Section className="pt-12 lg:pt-20 pb-24">
      <SectionHeading
        eyebrow="Shop"
        title={`Shop ${shopName} products`}
        description="Browse our products and check out online — pick up in store or download instantly for digital items."
      />

      <div className="flex items-center justify-between gap-4 mb-8">
        <p className="text-sm text-muted-foreground">
          {products.length} {products.length === 1 ? 'product' : 'products'}
        </p>
        {count > 0 && (
          <Button asChild variant="outline" className="gap-2">
            <Link href="/shop/cart" className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" aria-hidden />
              View cart ({count})
            </Link>
          </Button>
        )}
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground">No products are published yet. Check back soon.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((p) => (
            <Card key={p.id} className="flex flex-col overflow-hidden">
              {p.images[0] ? (
                <img src={p.images[0]} alt={p.name} className="aspect-square w-full object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center bg-muted" aria-hidden>
                  <ShoppingBag className="h-10 w-10 text-muted-foreground/50" />
                </div>
              )}
              <CardContent className="flex-1 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-tight">{p.name}</h3>
                  <div className="text-right shrink-0">
                    <p className="font-semibold">{formatPrice(p.price)}</p>
                    {p.compareAtPrice && p.compareAtPrice > p.price ? (
                      <p className="text-xs text-muted-foreground line-through">
                        {formatPrice(p.compareAtPrice)}
                      </p>
                    ) : null}
                  </div>
                </div>
                {p.description ? (
                  <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{p.description}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-muted px-2 py-0.5">
                    {p.productType === 'DIGITAL' ? 'Digital download' : 'Physical'}
                  </span>
                  {!p.inStock && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">Out of stock</span>
                  )}
                </div>
              </CardContent>
              <CardFooter className="p-4 pt-0">
                <Button
                  className="w-full"
                  disabled={!p.inStock}
                  onClick={() => add(p)}
                  aria-label={`Add ${p.name} to cart`}
                >
                  {justAdded === p.id ? (
                    <>
                      <Check className="h-4 w-4" aria-hidden /> Added
                    </>
                  ) : (
                    'Add to cart'
                  )}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
    </Section>
  )
}
