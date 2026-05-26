// Shared print helpers - open a popup window with print-friendly HTML and trigger print.

const baseStyles = `
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Cairo', 'Tajawal', 'Segoe UI', Arial, sans-serif; direction: rtl; color: #111; margin: 0; padding: 0; }
  h1, h2, h3 { margin: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #7c3aed; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { color: #7c3aed; font-size: 22px; font-weight: 800; }
  .brand small { display: block; color: #555; font-weight: normal; font-size: 12px; margin-top: 2px; }
  .doc-title { background: #f97316; color: #fff; padding: 6px 14px; border-radius: 6px; font-weight: 700; font-size: 16px; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; font-size: 13px; margin-bottom: 12px; }
  .meta div { padding: 4px 0; }
  .meta b { color: #333; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 6px; }
  th, td { border: 1px solid #d1d5db; padding: 6px 8px; text-align: right; }
  thead th { background: #f3f0ff; color: #4c1d95; font-weight: 700; }
  tfoot td { font-weight: 700; background: #fafafa; }
  .totals { margin-top: 10px; width: 320px; margin-inline-start: auto; font-size: 13px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e5e7eb; }
  .totals .grand { border-top: 2px solid #7c3aed; border-bottom: none; padding-top: 8px; margin-top: 6px; font-size: 16px; font-weight: 800; color: #7c3aed; }
  .footer { margin-top: 28px; display: flex; justify-content: space-between; font-size: 12px; color: #555; border-top: 1px dashed #d1d5db; padding-top: 10px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; background: #f3f0ff; color: #4c1d95; }
  .note { margin-top: 8px; padding: 8px; background: #fff7ed; border-right: 3px solid #f97316; font-size: 12px; }
  @media print { .no-print { display: none !important; } }
`;

const openPrint = (title: string, bodyHtml: string) => {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    alert("الرجاء السماح بالنوافذ المنبثقة لإتمام الطباعة");
    return;
  }
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${baseStyles}</style></head><body>${bodyHtml}<script>window.addEventListener('load',()=>{setTimeout(()=>{window.focus();window.print();},250);});</script></body></html>`);
  w.document.close();
};

export interface PrintOrderItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  is_half_kg?: boolean;
  product_unit?: string | null;
  offer_name?: string | null;
}

export interface PrintOrderData {
  order_number: string;
  created_at: string;
  customer_name: string;
  customer_phone?: string;
  delivery_address?: string | null;
  payment_method?: string;
  payment_status?: string;
  source_warehouse_name?: string | null;
  notes?: string | null;
  items: PrintOrderItem[];
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  created_by_name?: string | null;
}

const fmt = (n: number) => Number(n || 0).toLocaleString("en-US");

export const printOrderInvoice = (order: PrintOrderData) => {
  const dt = new Date(order.created_at);
  const dateStr = dt.toLocaleString("ar-EG", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const itemsHtml = order.items.map((it, i) => {
    const qtyLabel = `${fmt(it.quantity)}${it.is_half_kg ? " (نصف كيلو)" : ""}${it.product_unit ? " " + it.product_unit : ""}`;
    const nameLabel = `${it.product_name}${it.offer_name ? ` <span class="badge">${it.offer_name}</span>` : ""}`;
    return `<tr><td>${i + 1}</td><td>${nameLabel}</td><td>${qtyLabel}</td><td>${fmt(it.unit_price)}</td><td>${fmt(it.total_price)}</td></tr>`;
  }).join("");

  const paymentMap: Record<string, string> = { cash: "نقدي عند الاستلام", online: "إلكتروني" };
  const payStatusMap: Record<string, string> = { paid: "مدفوع", pending: "غير مدفوع", failed: "فشل الدفع" };

  const body = `
    <div class="header">
      <div class="brand">العاصمة للنعام<small>Capital Ostrich</small></div>
      <div class="doc-title">فاتورة طلب</div>
    </div>
    <div class="meta">
      <div><b>رقم الفاتورة:</b> ${order.order_number}</div>
      <div><b>التاريخ:</b> ${dateStr}</div>
      <div><b>اسم العميل:</b> ${order.customer_name || "-"}</div>
      <div><b>الهاتف:</b> <span dir="ltr">${order.customer_phone || "-"}</span></div>
      ${order.delivery_address ? `<div style="grid-column: span 2"><b>العنوان:</b> ${order.delivery_address}</div>` : ""}
      ${order.source_warehouse_name ? `<div><b>مصدر التنفيذ:</b> ${order.source_warehouse_name}</div>` : ""}
      ${order.payment_method ? `<div><b>طريقة الدفع:</b> ${paymentMap[order.payment_method] || order.payment_method}</div>` : ""}
      ${order.payment_status ? `<div><b>حالة الدفع:</b> ${payStatusMap[order.payment_status] || order.payment_status}</div>` : ""}
      ${order.created_by_name ? `<div><b>منشئ الطلب:</b> ${order.created_by_name}</div>` : ""}
    </div>
    <table>
      <thead><tr><th style="width:40px">#</th><th>المنتج</th><th style="width:120px">الكمية</th><th style="width:110px">سعر الوحدة</th><th style="width:120px">الإجمالي</th></tr></thead>
      <tbody>${itemsHtml || `<tr><td colspan="5" style="text-align:center;color:#888;padding:14px">لا توجد منتجات</td></tr>`}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>المجموع الفرعي</span><span>${fmt(order.subtotal)} ج.م</span></div>
      ${order.discount > 0 ? `<div class="row"><span>الخصم</span><span>- ${fmt(order.discount)} ج.م</span></div>` : ""}
      <div class="row"><span>رسوم التوصيل</span><span>${fmt(order.delivery_fee)} ج.م</span></div>
      <div class="row grand"><span>الإجمالي</span><span>${fmt(order.total)} ج.م</span></div>
    </div>
    ${order.notes ? `<div class="note"><b>ملاحظات:</b> ${order.notes}</div>` : ""}
    <div class="footer">
      <div>شكراً لتعاملكم معنا — العاصمة للنعام</div>
      <div>طُبعت في: ${new Date().toLocaleString("ar-EG")}</div>
    </div>
  `;
  openPrint(`فاتورة ${order.order_number}`, body);
};

export interface PrintStockRow {
  name: string;
  unit: string;
  agouza: number;
  main: number;
}

export type StockPrintMode = "both" | "agouza" | "main";

export const printWarehouseStock = (
  rows: PrintStockRow[],
  opts?: { title?: string; filter?: string; mode?: StockPrintMode }
) => {
  const mode: StockPrintMode = opts?.mode || "both";
  const now = new Date().toLocaleString("ar-EG");
  const title = opts?.title || (
    mode === "agouza" ? "المتاح في مخزن العجوزة" :
    mode === "main" ? "المتاح في المخزن الرئيسي" :
    "المتاح في المخازن"
  );

  let headerCols = "";
  let bodyRows = "";
  let footerRow = "";

  if (mode === "both") {
    const totalAg = rows.reduce((s, r) => s + (r.agouza || 0), 0);
    const totalMn = rows.reduce((s, r) => s + (r.main || 0), 0);
    headerCols = `<th style="width:80px">الوحدة</th><th style="width:110px">مخزن العجوزة</th><th style="width:110px">المخزن الرئيسي</th><th style="width:110px">الإجمالي</th>`;
    bodyRows = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.unit || "-"}</td><td>${fmt(r.agouza)}</td><td>${fmt(r.main)}</td><td><b>${fmt(r.agouza + r.main)}</b></td></tr>`).join("");
    footerRow = `<tr><td colspan="3">الإجمالي</td><td>${fmt(totalAg)}</td><td>${fmt(totalMn)}</td><td>${fmt(totalAg + totalMn)}</td></tr>`;
  } else {
    const getVal = (r: PrintStockRow) => mode === "agouza" ? r.agouza : r.main;
    const label = mode === "agouza" ? "مخزن العجوزة" : "المخزن الرئيسي";
    const total = rows.reduce((s, r) => s + getVal(r), 0);
    headerCols = `<th style="width:80px">الوحدة</th><th style="width:140px">${label}</th>`;
    bodyRows = rows.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.unit || "-"}</td><td><b>${fmt(getVal(r))}</b></td></tr>`).join("");
    footerRow = `<tr><td colspan="3">الإجمالي</td><td>${fmt(total)}</td></tr>`;
  }

  const body = `
    <div class="header">
      <div class="brand">العاصمة للنعام<small>Capital Ostrich</small></div>
      <div class="doc-title">${title}</div>
    </div>
    <div class="meta">
      <div><b>تاريخ التقرير:</b> ${now}</div>
      ${opts?.filter ? `<div><b>تصفية:</b> ${opts.filter}</div>` : ""}
      <div><b>عدد المنتجات:</b> ${rows.length}</div>
    </div>
    <table>
      <thead><tr><th style="width:40px">#</th><th>المنتج</th>${headerCols}</tr></thead>
      <tbody>${bodyRows}</tbody>
      <tfoot>${footerRow}</tfoot>
    </table>
    <div class="footer">
      <div>العاصمة للنعام — ${title}</div>
      <div>طُبعت في: ${now}</div>
    </div>
  `;
  openPrint(title, body);
};
