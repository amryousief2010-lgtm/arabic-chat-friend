// Offer price groups — products that share the SAME unit price inside an offer/bundle.
// Used when swapping a product inside an offer so the unit price stays the
// offer price, not the product's normal catalog price.

export type OfferPriceGroup = "G1" | "G2" | "G3" | "G4" | "G5";

// Source of truth — name-based (case/whitespace-insensitive match by normalized substring).
// Each group lists the canonical product names that belong to it.
const GROUPS: Record<OfferPriceGroup, string[]> = {
  G1: ["كفتة", "برجر", "سجق", "مفروم"],
  G2: ["لحم قطع", "رول"],
  G3: ["موزة", "استيك"],
  G4: ["دبوس", "فراشة"],
  G5: ["تربيانكو", "اسكالوب"],
};

const normalize = (s: string | null | undefined): string =>
  (s || "")
    .toString()
    .trim()
    .replace(/\س+/g, " ")
    .toLowerCase();

/**
 * Returns the offer price group a product belongs to based on its name,
 * or null if it doesn't belong to any offer pricing group.
 *
 * Matching is by substring (normalized) so variants like
 * "لحم قطع طازج" or "كفتة بقري" still resolve to their group.
 */
export function getOfferPriceGroup(productName?: string | null): OfferPriceGroup | null {
  const name = normalize(productName);
  if (!name) return null;
  for (const [group, keywords] of Object.entries(GROUPS) as [OfferPriceGroup, string[]][]) {
    for (const kw of keywords) {
      if (name.includes(normalize(kw))) return group;
    }
  }
  return null;
}

export interface OfferItemLike {
  product_id?: string | null;
  product_name?: string;
  offer_name?: string | null;
  unit_price: number;
}

/**
 * Decide the unit price to apply when swapping a product inside an offer.
 *
 * - If old item is part of an offer and new product is in the SAME group →
 *   keep the old offer unit price.
 * - Else if new product is in a DIFFERENT group → use the offer's price for
 *   the NEW group: first try any sibling offer item in that group, otherwise
 *   fall back to `offerGroupPriceFallback` (looked up from the offer box).
 * - Else (new product not in any group) → use the catalog price.
 *
 * For non-offer items, always returns the catalog price.
 */
export function getOfferUnitPriceForReplacement(
  oldItem: OfferItemLike,
  newProduct: { id: string; name: string; price: number },
  siblingOfferItems: OfferItemLike[],
  offerGroupPriceFallback?: number | null
): number {
  const isOfferItem = !!oldItem.offer_name;
  if (!isOfferItem) return Number(newProduct.price);

  const oldGroup = getOfferPriceGroup(oldItem.product_name);
  const newGroup = getOfferPriceGroup(newProduct.name);

  if (oldGroup && newGroup && oldGroup === newGroup) {
    return Number(oldItem.unit_price);
  }

  if (newGroup) {
    // Look for an existing sibling offer item in the same group → reuse its price.
    const sibling = siblingOfferItems.find(
      (it) =>
        !!it.offer_name &&
        it.product_id !== null &&
        it.product_id !== undefined &&
        getOfferPriceGroup(it.product_name) === newGroup
    );
    if (sibling) return Number(sibling.unit_price);
    if (offerGroupPriceFallback != null && Number(offerGroupPriceFallback) > 0) {
      return Number(offerGroupPriceFallback);
    }
  }

  return Number(newProduct.price);
}
