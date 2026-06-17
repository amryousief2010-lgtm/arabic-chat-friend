// Static snapshot imported from "ملف بيانات مصنع الاعلاف.xlsx" — sheets LV_* ONLY.
// Period: 2026-01-01 → 2026-06-17. LV_ sheets are the single source of truth.
// Do NOT mix with raw Arabic sheets (avoids double counting).

export const LV_PERIOD = { start: "2026-01-01", end: "2026-06-17" };

export type KpiRow = {
  key: string;
  ar: string;
  value: number;
  unit: "ton" | "EGP";
  source: string;
  notes: string;
};

export const LV_KPI: KpiRow[] = [
  { key: "total_feed_production_ton", ar: "إجمالي إنتاج مصنع العلف", value: 46.779, unit: "ton", source: "ملخص الإنتاج", notes: "يشمل المخزون التام المتبقي فقط ولا يشمل مخزون الخامات" },
  { key: "distributed_sold_transferred_ton", ar: "إجمالي المبيعات والتوريدات والسحوبات", value: 45.5, unit: "ton", source: "ملخص الإنتاج", notes: "أرقام المبيعات والتوريدات الداخلية كما هي دون تعديل" },
  { key: "external_sales_feed_ton", ar: "مبيعات خارجية علف تسمين", value: 26, unit: "ton", source: "ملخص الإنتاج", notes: "علف تسمين لعملاء خارجيين" },
  { key: "mother_farm_supply_ton", ar: "توريد داخلي لمزرعة الأمهات", value: 17, unit: "ton", source: "ملخص الإنتاج", notes: "علف بياض" },
  { key: "brooding_fattening_withdrawal_ton", ar: "سحب قسم التحضين والتسمين", value: 1.5, unit: "ton", source: "سحوبات داخلية", notes: "علف باديء" },
  { key: "slaughterhouse_withdrawal_ton", ar: "سحب المجزر", value: 1, unit: "ton", source: "سحوبات داخلية", notes: "علف تسمين لأكل النعام فترة توقفه قبل الذبح" },
  { key: "finished_goods_inventory_ton", ar: "مخزون علف تام متبقي", value: 1.279, unit: "ton", source: "المخزون المتبقي", notes: "علف تسمين + علف باديء" },
  { key: "raw_material_inventory_ton", ar: "مخزون خامات متبقي", value: 2.172, unit: "ton", source: "المخزون المتبقي", notes: "بريمكس بياض + بريمكس تسمين + دريس حجازي" },
  { key: "total_remaining_inventory_ton", ar: "إجمالي المخزون المتبقي", value: 3.451, unit: "ton", source: "المخزون المتبقي", notes: "تام + خامات" },
  { key: "raw_material_purchases_egp", ar: "إجمالي مشتريات الخامات", value: 734558, unit: "EGP", source: "تجميعي المشتريات", notes: "مشتريات بياض + مشتريات تسمين" },
  { key: "external_sales_value_egp", ar: "إجمالي المبيعات الخارجية", value: 524974, unit: "EGP", source: "تجميعي مصنع العلف", notes: "مبيعات الأعلاف لعملاء الخارج" },
  { key: "mother_farm_supply_value_egp", ar: "قيمة توريد علف لمزرعة الأمهات", value: 301998.64, unit: "EGP", source: "توريد علف لمزرعة الامهات", notes: "قيمة داخلية محاسبية" },
  { key: "brooding_internal_sales_value_egp", ar: "قيمة مبيعات داخلية للتحضين والتسمين", value: 5200, unit: "EGP", source: "feed_sales (destination=brooding_feed_store)", notes: "علف باديء — قيمة داخلية" },
  { key: "slaughterhouse_internal_sales_value_egp", ar: "قيمة مبيعات داخلية للمجزر", value: 3520, unit: "EGP", source: "feed_sales (destination=slaughterhouse_feed_store)", notes: "علف تسمين لأكل النعام قبل الذبح" },
  { key: "cash_margin_before_expenses_egp", ar: "هامش نقدي تقريبي قبل المصروفات", value: -209584, unit: "EGP", source: "تجميعي مصنع العلف", notes: "مبيعات خارجية - مشتريات خامات فقط" },
  { key: "production_balance_variance_ton", ar: "فرق توازن الإنتاج", value: 0, unit: "ton", source: "ملخص الإنتاج", notes: "PASS" },
];

// إجمالي المبيعات = خارجية + توريد الأمهات + مبيعات داخلية للتحضين + مبيعات داخلية للمجزر
// محسوب ديناميكياً من LV_KPI بدون قيم ثابتة
export const lvTotalSalesValue = (): number =>
  LV_KPI.filter((k) =>
    [
      "external_sales_value_egp",
      "mother_farm_supply_value_egp",
      "brooding_internal_sales_value_egp",
      "slaughterhouse_internal_sales_value_egp",
    ].includes(k.key),
  ).reduce((s, k) => s + k.value, 0);

export const lvInternalSalesValue = (): number =>
  LV_KPI.filter((k) =>
    [
      "mother_farm_supply_value_egp",
      "brooding_internal_sales_value_egp",
      "slaughterhouse_internal_sales_value_egp",
    ].includes(k.key),
  ).reduce((s, k) => s + k.value, 0);

export type FlowRow = {
  id: string;
  type: "external_sale" | "internal_supply" | "internal_withdrawal" | "ending_inventory_finished";
  movement_ar: string;
  counterparty: string;
  feed_type: string;
  qty_ton: number;
  qty_kg: number;
  value_egp: number | null;
  notes: string;
};

export const LV_FEED_FLOW: FlowRow[] = [
  { id: "FLOW-001", type: "external_sale", movement_ar: "مبيعات خارجية", counterparty: "عملاء خارجيين", feed_type: "علف تسمين", qty_ton: 26, qty_kg: 26000, value_egp: 524974, notes: "مبيعات علف تسمين لعملاء خارج الشركة" },
  { id: "FLOW-002", type: "internal_supply", movement_ar: "توريد داخلي", counterparty: "مزرعة الأمهات", feed_type: "علف بياض", qty_ton: 17, qty_kg: 17000, value_egp: 301998.64, notes: "توريد داخلي لمزرعة الأمهات" },
  { id: "FLOW-003", type: "internal_withdrawal", movement_ar: "سحب داخلي", counterparty: "قسم التحضين والتسمين", feed_type: "علف باديء", qty_ton: 1.5, qty_kg: 1500, value_egp: null, notes: "سحب داخلي من أول العام حتى تاريخ اليوم" },
  { id: "FLOW-004", type: "internal_withdrawal", movement_ar: "سحب داخلي", counterparty: "المجزر", feed_type: "علف تسمين", qty_ton: 1, qty_kg: 1000, value_egp: null, notes: "أكل النعام فترة توقفه قبل الذبح" },
  { id: "FLOW-005", type: "ending_inventory_finished", movement_ar: "مخزون تام متبقي", counterparty: "المصنع", feed_type: "علف تسمين", qty_ton: 1.04, qty_kg: 1040, value_egp: null, notes: "1 طن و40 كجم متبقي بالمصنع" },
  { id: "FLOW-006", type: "ending_inventory_finished", movement_ar: "مخزون تام متبقي", counterparty: "المصنع", feed_type: "علف باديء", qty_ton: 0.239, qty_kg: 239, value_egp: null, notes: "239 كجم متبقي" },
];

export type InventoryRow = {
  id: string;
  category: "finished_goods" | "raw_material";
  category_ar: string;
  item: string;
  qty_ton: number;
  qty_kg: number;
  notes: string;
};

export const LV_INVENTORY: InventoryRow[] = [
  { id: "INV-001", category: "finished_goods", category_ar: "مخزون تام", item: "علف تسمين", qty_ton: 1.04, qty_kg: 1040, notes: "1 طن و40 كجم متبقي بالمصنع" },
  { id: "INV-002", category: "finished_goods", category_ar: "مخزون تام", item: "علف باديء", qty_ton: 0.239, qty_kg: 239, notes: "239 كجم متبقي بالمصنع" },
  { id: "INV-003", category: "raw_material", category_ar: "مادة خام", item: "بريمكس بياض", qty_ton: 0.296, qty_kg: 296, notes: "296 كجم مادة خام" },
  { id: "INV-004", category: "raw_material", category_ar: "مادة خام", item: "بريمكس تسمين", qty_ton: 0.15, qty_kg: 150, notes: "150 كجم مادة خام" },
  { id: "INV-005", category: "raw_material", category_ar: "مادة خام", item: "دريس حجازي", qty_ton: 1.726, qty_kg: 1726, notes: "1,726 كجم مادة خام" },
];

export type MonthlyRow = {
  month: string;
  month_ar: string;
  purchases_egp: number;
  external_sales_egp: number;
  mother_farm_value_egp: number;
  mother_farm_ton: number;
};

export const LV_MONTHLY: MonthlyRow[] = [
  { month: "2026-01", month_ar: "يناير", purchases_egp: 82943, external_sales_egp: 71590, mother_farm_value_egp: 53235.2, mother_farm_ton: 3.12 },
  { month: "2026-02", month_ar: "فبراير", purchases_egp: 107040, external_sales_egp: 106500, mother_farm_value_egp: 33421.44, mother_farm_ton: 2.08 },
  { month: "2026-03", month_ar: "مارس", purchases_egp: 115560, external_sales_egp: 98850, mother_farm_value_egp: 19456, mother_farm_ton: 1 },
  { month: "2026-04", month_ar: "أبريل", purchases_egp: 109995, external_sales_egp: 105384, mother_farm_value_egp: 55921.48, mother_farm_ton: 3.015 },
  { month: "2026-05", month_ar: "مايو", purchases_egp: 289100, external_sales_egp: 111630, mother_farm_value_egp: 139964.52, mother_farm_ton: 7.08 },
  { month: "2026-06", month_ar: "يونيو", purchases_egp: 29920, external_sales_egp: 31020, mother_farm_value_egp: 0, mother_farm_ton: 0 },
];

export type CheckRow = {
  id: string;
  key: string;
  ar: string;
  value: number;
  unit: string;
  status: "PASS" | "FAIL";
  notes: string;
};

export const LV_CHECKS: CheckRow[] = [
  { id: "CHK-001", key: "production_balance", ar: "توازن إنتاج المصنع المعدل", value: 0, unit: "ton", status: "PASS", notes: "46.779 إنتاج = 45.5 مبيعات/توريدات/سحوبات + 1.279 مخزون تام" },
  { id: "CHK-002", key: "distributed_quantity_total", ar: "تجميع المبيعات والتوريدات والسحوبات", value: 45.5, unit: "ton", status: "PASS", notes: "26 + 17 + 1.5 + 1" },
  { id: "CHK-003", key: "finished_inventory_total", ar: "تجميع المخزون التام", value: 1.279, unit: "ton", status: "PASS", notes: "1.040 + 0.239" },
  { id: "CHK-004", key: "raw_inventory_total", ar: "تجميع مخزون الخامات", value: 2.172, unit: "ton", status: "PASS", notes: "0.296 + 0.150 + 1.726" },
  { id: "CHK-005", key: "all_remaining_inventory_total", ar: "إجمالي المخزون المتبقي", value: 3.451, unit: "ton", status: "PASS", notes: "1.279 تام + 2.172 خامات" },
];

export const kpi = (key: string) => LV_KPI.find((k) => k.key === key)!;
