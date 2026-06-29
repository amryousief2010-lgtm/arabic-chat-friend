export interface WarehouseDropdownItem {
  id: string;
  warehouse_id?: string | null;
  product_id?: string | null;
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  stock?: number | null;
  sku?: string | null;
  item_code?: string | null;
  barcode?: string | null;
  is_active?: boolean | null;
  archived?: boolean | null;
  archived_at?: string | null;
  module?: string | null;
  item_type?: string | null;
  source_module?: string | null;
  updated_at?: string | null;
}

export const isWarehouseItemActive = (item: WarehouseDropdownItem): boolean =>
  item.is_active !== false;

// Modules that physically live inside the main warehouse but represent
// factory raw materials / packaging stocks. These must NEVER appear in
// the main-warehouse dispatch/supply dropdowns even if their warehouse_id
// matches — they are owned by the factories and have their own dedicated
// inventory screens. Items whose module is NULL, "warehouse", "sales",
// or "meat" are considered legitimate main-warehouse stock.
const FACTORY_ONLY_MODULES = new Set(["meat_factory", "feed_factory", "packaging"]);

export const isMainWarehouseStockItemAllowed = (item: WarehouseDropdownItem): boolean => {
  if (!isWarehouseItemActive(item)) return false;
  const module = (item.module || "").toString().toLowerCase();
  if (FACTORY_ONLY_MODULES.has(module)) return false;
  // For main-warehouse dispatches, the only item-level rule is that the
  // inventory_items row itself is active and not a factory-owned module.
  // Do not require product_id/category:
  // legitimate main-warehouse products can exist with product_id = NULL.
  return isWarehouseItemActive(item);
};

export const isAllowedWarehouseDropdownItem = (
  item: WarehouseDropdownItem,
  warehouseId: string | null | undefined,
  isMainWarehouse: boolean,
  visibleProductIds?: Set<string>,
): boolean => {
  if (!warehouseId || !item.id) return false;
  if (item.warehouse_id !== warehouseId) return false;
  if (!isWarehouseItemActive(item)) return false;
  if (isMainWarehouse && !isMainWarehouseStockItemAllowed(item)) return false;
  // visibleProductIds is kept only for backward compatibility with older callers.
  // It must not be used for main-warehouse validation because product_id may be NULL.
  return true;
};

const itemSortValue = (item: WarehouseDropdownItem) => ({
  stock: Number(item.stock || 0),
  updatedAt: item.updated_at ? new Date(item.updated_at).getTime() : 0,
  linked: item.product_id ? 1 : 0,
});

const normalizeIdentityPart = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");

const identityKey = (item: WarehouseDropdownItem) => [
  normalizeIdentityPart(item.name),
  normalizeIdentityPart(item.unit),
  normalizeIdentityPart(item.category),
].join("|");

const preferItem = <T extends WarehouseDropdownItem>(candidate: T, current: T): T => {
  const a = itemSortValue(candidate);
  const b = itemSortValue(current);
  if (a.linked !== b.linked) return a.linked > b.linked ? candidate : current;
  if (a.stock !== b.stock) return a.stock > b.stock ? candidate : current;
  return a.updatedAt > b.updatedAt ? candidate : current;
};

export const getAllowedWarehouseDropdownItems = <T extends WarehouseDropdownItem>(
  items: T[],
  warehouseId: string | null | undefined,
  isMainWarehouse: boolean,
  visibleProductIds?: Set<string>,
): T[] => {
  const byKey = new Map<string, T>();
  const allowed = items.filter((item) => isAllowedWarehouseDropdownItem(item, warehouseId, isMainWarehouse, visibleProductIds));
  const linkedNames = new Set(
    allowed
      .filter((item) => !!item.product_id)
      .map((item) => normalizeIdentityPart(item.name))
      .filter(Boolean),
  );

  allowed
    // If an old orphan row has the same display name as a valid product-linked row,
    // hide the orphan from dropdowns to avoid choosing the wrong duplicate.
    .filter((item) => !!item.product_id || !linkedNames.has(normalizeIdentityPart(item.name)))
    .forEach((item) => {
      const key = item.product_id || item.id;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, item);
        return;
      }
      byKey.set(key, preferItem(item, current));
    });

  const byIdentity = new Map<string, T>();
  Array.from(byKey.values()).forEach((item) => {
    const key = identityKey(item);
    if (!key || key === "||") {
      byIdentity.set(item.product_id || item.id, item);
      return;
    }
    const current = byIdentity.get(key);
    byIdentity.set(key, current ? preferItem(item, current) : item);
  });

  return Array.from(byIdentity.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "ar"),
  );
};

export const getWarehouseItemRejectionReason = (
  item: WarehouseDropdownItem | undefined | null,
  expectedWarehouseId?: string | null,
  isMainWarehouse: boolean = false,
): string => {
  if (!item) return "ITEM_NOT_FOUND_IN_INVENTORY_ITEMS";
  if (expectedWarehouseId && item.warehouse_id !== expectedWarehouseId) return "WAREHOUSE_ID_MISMATCH";
  if (!isWarehouseItemActive(item)) return "ITEM_NOT_ACTIVE";
  if (isMainWarehouse) {
    const module = (item.module || "").toString().toLowerCase();
    if (FACTORY_ONLY_MODULES.has(module)) return "FACTORY_OWNED_MODULE";
  }
  return "";
};

export const getWarehouseItemDebugRow = (
  item: WarehouseDropdownItem,
  expectedWarehouseId?: string | null,
  warehouseName?: string | null,
) => {
  const rejectionReason = getWarehouseItemRejectionReason(item, expectedWarehouseId);
  return {
    item_id: item.id,
    warehouse_id: item.warehouse_id || null,
    warehouse_name: warehouseName || null,
    product_id: item.product_id || null,
    item_name: item.name || null,
    validation_result: !rejectionReason,
    rejection_reason: rejectionReason,
    active: isWarehouseItemActive(item),
  };
};

export const getWarehouseMissingItemDebugRow = (
  itemId: string,
  expectedWarehouseId?: string | null,
  warehouseName?: string | null,
) => ({
  item_id: itemId,
  warehouse_id: null,
  warehouse_name: warehouseName || null,
  product_id: null,
  item_name: null,
  validation_result: false,
  rejection_reason: "ITEM_NOT_FOUND_IN_INVENTORY_ITEMS",
  active: false,
});
