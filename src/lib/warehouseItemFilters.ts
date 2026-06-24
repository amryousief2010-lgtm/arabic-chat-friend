import { isMainWarehouseExcludedCategory } from "@/constants/warehouseCategoryFilters";

export interface WarehouseDropdownItem {
  id: string;
  warehouse_id?: string | null;
  product_id?: string | null;
  name?: string | null;
  category?: string | null;
  unit?: string | null;
  stock?: number | null;
  is_active?: boolean | null;
  archived?: boolean | null;
  archived_at?: string | null;
  module?: string | null;
  item_type?: string | null;
  source_module?: string | null;
  updated_at?: string | null;
}

const norm = (v?: string | null) => String(v || "").trim().toLowerCase();

const BLOCKED_MAIN_ITEM_TYPES = new Set([
  "raw_material",
  "raw_materials",
  "feed_raw",
  "feed_raw_material",
  "feed_raw_materials",
  "meat_factory_raw",
  "meat_raw",
  "packaging",
  "packing",
]);

const BLOCKED_MAIN_MODULES = new Set([
  "feed",
  "feed_factory",
  "feed_raw",
  "feed_raw_materials",
  "meat_factory",
  "meat_factory_raw",
  "meat_raw",
  "packaging",
  "meat_packaging",
]);

export const isWarehouseItemActive = (item: WarehouseDropdownItem): boolean =>
  item.is_active !== false && item.archived !== true && !item.archived_at;

export const isMainWarehouseStockItemAllowed = (item: WarehouseDropdownItem): boolean => {
  const itemType = norm(item.item_type) || norm(item.category);
  const sourceModule = norm(item.source_module) || norm(item.module);
  return Boolean(item.product_id)
    && !isMainWarehouseExcludedCategory(item.category)
    && !BLOCKED_MAIN_ITEM_TYPES.has(itemType)
    && !BLOCKED_MAIN_MODULES.has(sourceModule);
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
  if (isMainWarehouse && visibleProductIds && (!item.product_id || !visibleProductIds.has(item.product_id))) return false;
  return true;
};

const itemSortValue = (item: WarehouseDropdownItem) => ({
  stock: Number(item.stock || 0),
  updatedAt: item.updated_at ? new Date(item.updated_at).getTime() : 0,
});

export const getAllowedWarehouseDropdownItems = <T extends WarehouseDropdownItem>(
  items: T[],
  warehouseId: string | null | undefined,
  isMainWarehouse: boolean,
  visibleProductIds?: Set<string>,
): T[] => {
  const byKey = new Map<string, T>();
  items
    .filter((item) => isAllowedWarehouseDropdownItem(item, warehouseId, isMainWarehouse, visibleProductIds))
    .forEach((item) => {
      const key = item.product_id || item.id;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, item);
        return;
      }
      const a = itemSortValue(item);
      const b = itemSortValue(current);
      if (a.stock > b.stock || (a.stock === b.stock && a.updatedAt > b.updatedAt)) {
        byKey.set(key, item);
      }
    });

  return Array.from(byKey.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "ar"),
  );
};

export const getWarehouseItemDebugRow = (item: WarehouseDropdownItem) => ({
  item_id: item.id,
  product_id: item.product_id || null,
  warehouse_id: item.warehouse_id || null,
  item_type: item.item_type || item.category || null,
  source_module: item.source_module || item.module || null,
  name: item.name || null,
});
