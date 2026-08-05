import * as XLSX from "xlsx";

/**
 * تصدير الطلبات بنفس تنسيق شيت "تسجيل اوردرات لحم نعام" (Google Form Responses):
 * صف لكل أوردر + عمود لكل صنف بالكمية.
 */

export interface SheetExportItem {
  product_name: string;
  quantity: number;
  offer_name?: string | null;
}

export interface SheetExportOrder {
  created_at: string;
  moderator_name?: string;
  source?: string | null;
  customer_name: string;
  status: string;
  customer_phone?: string;
  customer_phone2?: string | null;
  delivery_address?: string | null;
  shipping_company?: string | null;
  subtotal?: number;
  total?: number;
  delivery_fee?: number;
  notes?: string | null;
  governorate?: string | null;
  order_number?: string;
  items: SheetExportItem[];
}

const PRODUCT_COLUMNS = [
  "بيض",
  " دبوس6 كيلو",
  " فخدة او نص نعامة او نعامة صندوق",
  "لحم",
  "استيك",
  "موزة",
  "فراشة",
  "قطعية الدبوس",
  "تربيانكو ",
  "اسكالوب",
  "رول",
  "كباب",
  "كبدة",
  "قلب",
  "قوانص",
  "رقاب",
  "كوارع ",
  "دهن",
  "شاورما",
  "شيش",
  "كفتة",
  "سجق",
  "برجر",
  "طرب",
  "حواوشي",
  "مفروم",
  "كفتة أرز",
  "برجر بالجبنة",
  "ممبار",
  "نخاع",
] as const;

const norm = (s: string) =>
  (s || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/نعام(ه)?/g, "")
    .replace(/\s+/g, " ")
    .trim();

// الترتيب مهم: الأكثر تخصيصًا أولًا
const RULES: Array<{ col: (typeof PRODUCT_COLUMNS)[number]; test: (n: string) => boolean }> = [
  { col: "كفتة أرز", test: (n) => n.includes("كفت") && (n.includes("رز") || n.includes("ارز")) },
  { col: "برجر بالجبنة", test: (n) => n.includes("برجر") && n.includes("جبن") },
  { col: "قطعية الدبوس", test: (n) => n.includes("قطعيه الدبوس") || n.includes("قطعيه دبوس") },
  { col: " دبوس6 كيلو", test: (n) => n.includes("دبوس") },
  {
    col: " فخدة او نص نعامة او نعامة صندوق",
    test: (n) => n.includes("فخده") || n.includes("نص") || n.includes("صندوق"),
  },
  { col: "بيض", test: (n) => n.includes("بيض") },
  { col: "لحم", test: (n) => n.includes("لحم") },
  { col: "استيك", test: (n) => n.includes("استيك") },
  { col: "موزة", test: (n) => n.includes("موزه") },
  { col: "فراشة", test: (n) => n.includes("فراشه") },
  { col: "تربيانكو ", test: (n) => n.includes("تربيانكو") },
  { col: "اسكالوب", test: (n) => n.includes("اسكالوب") },
  { col: "رول", test: (n) => n.includes("رول") },
  { col: "كباب", test: (n) => n.includes("كباب") },
  { col: "كبدة", test: (n) => n.includes("كبد") },
  { col: "قلب", test: (n) => n.includes("قلب") },
  { col: "قوانص", test: (n) => n.includes("قوانص") },
  { col: "رقاب", test: (n) => n.includes("رقاب") },
  { col: "كوارع ", test: (n) => n.includes("كوارع") },
  { col: "دهن", test: (n) => n.includes("دهن") },
  { col: "شاورما", test: (n) => n.includes("شاورما") },
  { col: "شيش", test: (n) => n.includes("شيش") },
  { col: "كفتة", test: (n) => n.includes("كفت") },
  { col: "سجق", test: (n) => n.includes("سجق") },
  { col: "برجر", test: (n) => n.includes("برجر") },
  { col: "طرب", test: (n) => n.includes("طرب") },
  { col: "حواوشي", test: (n) => n.includes("حواوشي") },
  { col: "مفروم", test: (n) => n.includes("مفروم") },
  { col: "ممبار", test: (n) => n.includes("ممبار") },
  { col: "نخاع", test: (n) => n.includes("نخاع") },
];

function mapProductColumn(productName: string): string | null {
  const n = norm(productName);
  if (!n) return null;
  const hit = RULES.find((r) => r.test(n));
  return hit ? hit.col : null;
}

const STATUS_AR: Record<string, string> = {
  pending: "قيد الانتظار",
  processing: "جاري التجهيز",
  shipped: "تم الشحن",
  delivered: "تم",
  cancelled: "ملغي",
};

export function exportOrdersSheetStyle(
  orders: SheetExportOrder[],
  filename = `طلبات-تفصيلية-${new Date().toISOString().slice(0, 10)}.xlsx`,
) {
  const rows = orders.map((o) => {
    const row: Record<string, any> = {
      Timestamp: new Date(o.created_at).toLocaleString("ar-EG"),
      "رقم الاوردر": o.order_number || "",
      "الموديراتور": o.moderator_name || "",
      "مصدر العميل": o.source || "",
      "اسم العميل": o.customer_name || "",
      "حالة الاوردر": STATUS_AR[o.status] || o.status,
      "رقم العميل": o.customer_phone || "",
      "رقم اخر للعميل ان وجد": o.customer_phone2 || "",
      "العنوان بالتفصيل": o.delivery_address || "",
      "شركة الشحن": o.shipping_company || "",
      "قيمة الاوردر بدون شحن":
        Number(o.subtotal ?? (Number(o.total || 0) - Number(o.delivery_fee || 0))) || 0,
      "العرض": o.items.find((i) => i.offer_name)?.offer_name || "",
      "ملاحظات": o.notes || "",
    };
    PRODUCT_COLUMNS.forEach((c) => (row[c] = null));
    let other: string[] = [];
    o.items.forEach((it) => {
      const col = mapProductColumn(it.product_name);
      const qty = Number(it.quantity) || 0;
      if (col) row[col] = (Number(row[col]) || 0) + qty;
      else if (it.product_name?.trim()) other.push(`${it.product_name} (${qty})`);
    });
    row["المحافظة"] = o.governorate || "";
    row["أصناف أخرى"] = other.join(" + ");
    row["إجمالي الاوردر"] = Number(o.total || 0);
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = Object.keys(rows[0] || {}).map((k) => ({ wch: Math.max(10, Math.min(30, k.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
  XLSX.writeFile(wb, filename, { bookType: "xlsx" });
}
