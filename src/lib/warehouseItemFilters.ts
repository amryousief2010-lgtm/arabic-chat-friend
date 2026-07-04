export interface WarehouseDropdownItem {
  id: string;
  warehouse_id?: string | null;
  product_id?: string | null;
  product_is_active?: boolean | null;
  product_category?: string | null;
  product_name?: string | null;
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

export const MAIN_WAREHOUSE_ID = "5ec781b5-685b-4806-b59a-83a79ea5662c";
export const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";

export const isWarehouseItemActive = (item: WarehouseDropdownItem): boolean =>
  item.is_active !== false;

// Markers that represent factory/raw/packaging-only stock. They must NEVER
// appear in the main-warehouse dispatch/supply dropdown even if the physical
// inventory_items.warehouse_id is the main warehouse id.
const FACTORY_ONLY_MODULES = new Set([
  "meat_factory",
  "feed_factory",
  "packaging",
  "raw_materials",
  "factory_raw",
  "factory_packaging",
  "production_only",
]);

const BLOCKED_CATEGORY_KEYWORDS = [
  "خامة",
  "خامات",
  "خام",
  "تغليف",
  "تعبئة",
  "packaging",
  "feed",
  "أعلاف",
  "اعلاف",
  "تصنيع",
  "مدخلات",
  "مجزر",
  "مستلزمات",
  "تشغيل/خدمة",
];

const BLOCKED_NAME_KEYWORDS = [
  // Eggs belong to farm/hatchery flows, not the main warehouse dispatch/supply list.
  "بيض",
];

const getProductIsActive = (item: WarehouseDropdownItem): boolean | null => {
  const fromFlat = item.product_is_active;
  if (typeof fromFlat === "boolean") return fromFlat;
  const product = (item as any).product;
  if (typeof product?.is_active === "boolean") return product.is_active;
  return null;
};

const getProductCategory = (item: WarehouseDropdownItem): string | null => {
  if (item.product_category !== undefined) return item.product_category || null;
  return ((item as any).product?.category as string | null | undefined) || null;
};

const getProductName = (item: WarehouseDropdownItem): string | null => {
  if (item.product_name !== undefined) return item.product_name || null;
  return ((item as any).product?.name as string | null | undefined) || null;
};

const hasBlockedModule = (item: WarehouseDropdownItem): boolean => {
  const markers = [item.module, item.source_module, item.item_type, (item as any).product_type]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  return markers.some((marker) => FACTORY_ONLY_MODULES.has(marker));
};

const hasBlockedCategory = (item: WarehouseDropdownItem): boolean => {
  const categoryText = normalizeIdentityPart([item.category, getProductCategory(item)].filter(Boolean).join(" "));
  return BLOCKED_CATEGORY_KEYWORDS.some((keyword) => categoryText.includes(normalizeIdentityPart(keyword)));
};

const hasBlockedName = (item: WarehouseDropdownItem): boolean => {
  const nameText = normalizeIdentityPart([item.name, getProductName(item)].filter(Boolean).join(" "));
  return BLOCKED_NAME_KEYWORDS.some((keyword) => nameText.includes(normalizeIdentityPart(keyword)));
};

export const isMainWarehouseStockItemAllowed = (item: WarehouseDropdownItem): boolean => {
  if (!isWarehouseItemActive(item)) return false;
  if (item.warehouse_id !== MAIN_WAREHOUSE_ID) return false;
  if (!item.product_id) return false;
  if (getProductIsActive(item) !== true) return false;
  if (hasBlockedModule(item)) return false;
  if (hasBlockedCategory(item)) return false;
  if (hasBlockedName(item)) return false;
  return true;
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
    if (item.warehouse_id !== MAIN_WAREHOUSE_ID) return "MAIN_WAREHOUSE_ID_MISMATCH";
    if (!item.product_id) return "MAIN_WAREHOUSE_REQUIRES_ACTIVE_PRODUCT_LINK";
    if (getProductIsActive(item) !== true) return "PRODUCT_NOT_ACTIVE_OR_NOT_LOADED";
    if (hasBlockedModule(item)) return "FACTORY_OWNED_MODULE";
    if (hasBlockedCategory(item)) return "FACTORY_OR_RAW_OR_PACKAGING_CATEGORY";
    if (hasBlockedName(item)) return "NON_OPERATIONAL_MAIN_WAREHOUSE_ITEM";
  }
  return "";
};

export const getWarehouseItemDebugRow = (
  item: WarehouseDropdownItem,
  expectedWarehouseId?: string | null,
  warehouseName?: string | null,
  isMainWarehouse: boolean = false,
) => {
  const rejectionReason = getWarehouseItemRejectionReason(item, expectedWarehouseId, isMainWarehouse);
  return {
    item_id: item.id,
    warehouse_id: item.warehouse_id || null,
    warehouse_name: warehouseName || null,
    product_id: item.product_id || null,
    product_is_active: getProductIsActive(item),
    item_name: item.name || null,
    category: item.category || null,
    product_category: getProductCategory(item),
    module: item.module || null,
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
