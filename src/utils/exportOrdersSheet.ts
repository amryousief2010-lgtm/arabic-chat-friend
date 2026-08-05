import ExcelJS from "exceljs";

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
  "لحم قطع",
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

// الترتيب مهم: الأكثر تخصيصًا أولًا.
// ملاحظة: عمود (فخدة/نص نعامة/نعامة صندوق) في الآخر ومقيَّد بشروط دقيقة
// حتى لا يبتلع أصناف مثل "نص قوانص" أو "نص كيلو ...".
const RULES: Array<{ col: (typeof PRODUCT_COLUMNS)[number]; test: (n: string) => boolean }> = [
  { col: "كفتة أرز", test: (n) => n.includes("كفت") && (n.includes("رز") || n.includes("ارز")) },
  { col: "برجر بالجبنة", test: (n) => n.includes("برجر") && n.includes("جبن") },
  { col: "قطعية الدبوس", test: (n) => n.includes("قطعيه الدبوس") || n.includes("قطعيه دبوس") },
  { col: " دبوس6 كيلو", test: (n) => n.includes("دبوس") },
  { col: "بيض", test: (n) => n.includes("بيض") },
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
  {
    col: " فخدة او نص نعامة او نعامة صندوق",
    test: (n) =>
      n.includes("فخده") ||
      n.includes("صندوق") ||
      n === "نص" ||
      n === "نص كامله" ||
      n.includes("نص ذبيحه") ||
      n.includes("ذبيحه"),
  },
  // "لحم" عام — بعد كل الأصناف المتخصصة حتى لا يبتلع "لحم مفروم" مثلاً
  { col: "لحم قطع", test: (n) => n.includes("لحم") },
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

export async function exportOrdersSheetStyle(
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

  const headers = Object.keys(rows[0] || {});
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("الطلبات", { views: [{ rightToLeft: true }] });
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(10, Math.min(30, h.length + 4)) }));
  ws.getRow(1).font = { bold: true };

  const FILL: Record<string, string> = { delivered: "FFCCE5FF", cancelled: "FFFFC7CE" };

  rows.forEach((r, idx) => {
    const row = ws.addRow(r);
    const color = FILL[orders[idx]?.status || ""];
    if (color) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
      });
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
