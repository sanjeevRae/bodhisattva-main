import { useEffect, useMemo, useState } from "react";
import { useCustomer } from "./customer";
import type { ShopProductDetail, ShopVariant } from "./shop";

/**
 * The purchase state machine for one product detail — shared by the
 * shop QuickView modal and the product page so the two surfaces can
 * never drift apart (plan review amendment, 2026-11-23):
 *
 *  - the default variant is the first in-stock one (else the first);
 *  - price, availability and stock always describe the SELECTED
 *    variant, falling back to the product when it has no variants;
 *  - the quantity is clamped to the selected variant's availability,
 *    including when the variant changes under an already-chosen qty;
 *  - `inCartQty` counts the cart's units of this product + variant.
 */
export function useProductPurchase(detail: ShopProductDetail | null) {
  const { status, cart } = useCustomer();
  const [variantId, setVariantId] = useState<number | null>(null);
  const [qty, setQtyState] = useState(1);

  useEffect(() => {
    if (!detail) return;
    setVariantId(detail.variants.find((v) => v.inStock)?.id ?? detail.variants[0]?.id ?? null);
    setQtyState(1);
  }, [detail]);

  const variant: ShopVariant | null =
    detail?.variants.find((v) => v.id === variantId) ?? null;
  const pricePaisa = variant ? variant.effectivePricePaisa : (detail?.effectivePricePaisa ?? 0);
  const available = variant ? variant.availableQty : (detail?.availableQty ?? 0);
  const inStock = variant ? variant.inStock : (detail?.inStock ?? false);

  const clampQty = (next: number, cap: number) =>
    Math.min(Math.max(next, 1), Math.max(cap, 1));

  const setVariant = (id: number | null) => {
    setVariantId(id);
    const next = detail?.variants.find((v) => v.id === id) ?? null;
    const cap = next ? next.availableQty : (detail?.availableQty ?? 0);
    setQtyState((q) => clampQty(q, cap));
  };

  const setQty = (next: number) => setQtyState((q) => clampQty(next, available));

  const inCartQty = useMemo(() => {
    if (!detail) return 0;
    return (cart?.items ?? [])
      .filter((i) => i.productId === detail.id && i.variantId === (variant?.id ?? null))
      .reduce((sum, i) => sum + i.quantity, 0);
  }, [cart, detail, variant]);

  return {
    status,
    variant,
    variantId,
    setVariant,
    qty,
    setQty,
    pricePaisa,
    available,
    inStock,
    inCartQty,
  };
}
