// Product master-data gate (19 Nov 2026).
// Mirrors the DB trigger products_enforce_required_fields so users see the
// same Arabic reasons before the request is sent.

export const PROCESSED_MEAT_CATEGORY = "لحوم مصنعة";

export interface ProductReadiness {
  product_id: string;
  is_active: boolean;
  has_barcode: boolean;
  barcode_pending: boolean;
  cost_ok: boolean;
  pack_weight_kg: number | null;
  is_processed: boolean;
  factory_items: string[];
  stock_total: number;
  can_activate_role: boolean;
  blockers: string[];
}

export interface ProductGateInput {
  barcode: string;
  barcodePending: boolean;
  costPrice: string;
  packWeightKg: string;
}

/**
 * Returns the list of problems. When a requirement flag is false, an empty
 * cost / pack weight means "keep the current value" (the DB trigger only checks
 * a field when it changes); a filled value is still validated.
 */
export function validateProductGate(
  input: ProductGateInput,
  req: { requireCost: boolean; requirePack: boolean },
): string[] {
  const errors: string[] = [];
  const bc = input.barcode.trim();
  if (!bc) {
    if (!input.barcodePending) errors.push("اكتب كود المنتج (13 رقم) أو علّم «الكود تحت التسجيل»");
  } else if (!/^\d{13}$/.test(bc)) {
    errors.push("كود المنتج لازم يكون 13 رقم بالظبط");
  }

  const cost = input.costPrice.trim();
  if (req.requireCost || cost !== "") {
    const n = Number(cost);
    if (!cost || !Number.isFinite(n) || n <= 0) errors.push("تكلفة المنتج لازم تكون أكبر من صفر");
  }

  const pack = input.packWeightKg.trim();
  if (req.requirePack || pack !== "") {
    const n = Number(pack);
    if (!pack || !Number.isFinite(n) || n <= 0) errors.push("وزن العبوة (كجم) لازم يكون أكبر من صفر");
  }
  return errors;
}

/** Strip the machine code prefix (e.g. "PRODUCT_COST_REQUIRED: ") from DB errors. */
export function productDbErrorMessage(err: unknown, fallback = "حدث خطأ"): string {
  const msg = (err as { message?: string } | null)?.message || "";
  if (!msg) return fallback;
  if (/products_barcode_unique/.test(msg)) return "الكود مستخدم بالفعل لمنتج آخر";
  if (/products_name_unique/.test(msg)) return "يوجد منتج بنفس الاسم";
  const m = msg.match(/^(?:PRODUCT_[A-Z_]+|BARCODE_[A-Z_]+):\s*(.*)$/s);
  return m ? m[1] : msg;
}
