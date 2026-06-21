// Categories that should NEVER appear in the Main Warehouse views, even if
// the underlying inventory_items row has warehouse_id = main warehouse id.
// These items historically belong to other warehouses (meat factory raw,
// feed factory raw, packaging) but were mis-assigned in the database.
//
// Used to filter Main Warehouse tab/dialogs without modifying any data.
export const MAIN_WAREHOUSE_EXCLUDED_CATEGORIES: string[] = [
  "خامة تصنيع لحوم",
  "خامات أعلاف",
  "خامة مشتركة",
  "feed",
  "packaging",
  "تغليف",
];

const norm = (s?: string | null) => (s || "").toString().trim().toLowerCase();

export function isMainWarehouseExcludedCategory(category?: string | null): boolean {
  const c = norm(category);
  if (!c) return false;
  return MAIN_WAREHOUSE_EXCLUDED_CATEGORIES.some((k) => norm(k) === c);
}

export function isMainWarehouseName(name?: string | null): boolean {
  const n = (name || "").toString();
  return /رئيسي/.test(n) || /main/i.test(n) || /المقر/.test(n);
}
