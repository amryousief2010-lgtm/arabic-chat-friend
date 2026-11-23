/**
 * Orders-list product filter.
 *
 * The dropdown shows the product's current catalog name. order_items.product_name
 * is a snapshot from when the order was saved, so a later rename (for example
 * «6ك دبوس بالعظم» → «دبوس بالعظم») must not hide older orders. Match the
 * catalog product id, and also keep an exact snapshot-name match so rows that
 * were never linked to a product id still show when that exact name is chosen.
 * Similar legacy names («دبوس بالعظم نعام», «دبوس 7 كيلو») stay separate.
 */

export type CatalogProduct = {
  id: string;
  name: string;
};

export type OrderItemProductRef = {
  product_id?: string | null;
  product_name?: string | null;
};

export type ProductFilterLookup =
  | { kind: "product_id"; productIds: string[] }
  | { kind: "product_name"; productName: string };

const ALL_PRODUCTS = "all";

/** Catalog ids whose current name is the selected filter label. */
export function productIdsMatchingFilter(
  filterName: string,
  catalog: readonly CatalogProduct[],
): string[] {
  if (!filterName || filterName === ALL_PRODUCTS) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const product of catalog) {
    if (!product?.id || product.name !== filterName || seen.has(product.id)) continue;
    seen.add(product.id);
    ids.push(product.id);
  }
  return ids;
}

/**
 * Queries that together find every order line for the selected product.
 * Id lookup covers every historical snapshot name. Name lookup covers the
 * exact label, including rows whose product_id is null.
 */
export function productFilterLookups(
  filterName: string,
  catalog: readonly CatalogProduct[],
): ProductFilterLookup[] {
  if (!filterName || filterName === ALL_PRODUCTS) return [];
  const productIds = productIdsMatchingFilter(filterName, catalog);
  const lookups: ProductFilterLookup[] = [];
  if (productIds.length > 0) lookups.push({ kind: "product_id", productIds });
  lookups.push({ kind: "product_name", productName: filterName });
  return lookups;
}

export function orderItemMatchesProductFilter(
  item: OrderItemProductRef,
  filterName: string,
  productIds: readonly string[],
): boolean {
  if (!filterName || filterName === ALL_PRODUCTS) return true;
  if (item.product_id && productIds.includes(item.product_id)) return true;
  return item.product_name === filterName;
}

export function orderMatchesProductFilter(
  items: readonly OrderItemProductRef[],
  filterName: string,
  productIds: readonly string[],
): boolean {
  if (!filterName || filterName === ALL_PRODUCTS) return true;
  return items.some((item) => orderItemMatchesProductFilter(item, filterName, productIds));
}
