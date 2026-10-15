import { isOfferShippingLine } from "@/lib/orderTotals";
import { toCairoDateString } from "@/lib/cairoDate";

/**
 * Read-only factory gross margin.
 *
 * Cost comes from non-cancelled manufacturing invoices:
 * materials (raw_cost) + spices + packaging + extra_cost = total_manufacturing_cost.
 * Selling price comes from order lines, including offer-box lines at the
 * frozen per-line price already stored on the order. Shipping lines and
 * orders.delivery_fee are left out. Cancelled orders and cancelled invoices
 * are left out.
 *
 * The totals row follows the reference sheet: cost per ton is weighted by
 * tons produced for products that were also sold; selling price per ton is
 * weighted by kilos sold. Margin = (sell − cost) / sell.
 */

export const OUTLIER_UNIT_COST_EGP = 1000;

export interface FactoryProductDef {
  key: string;
  label: string;
}

export const FACTORY_PRODUCTS: FactoryProductDef[] = [
  { key: "burger", label: "برجر" },
  { key: "sausage", label: "سجق" },
  { key: "kofta", label: "كفتة" },
  { key: "mince", label: "مفروم" },
  { key: "rice_kofta", label: "كفتة الرز" },
  { key: "hawawshi", label: "حواوشي" },
  { key: "shawarma", label: "شاورما" },
  { key: "kebab", label: "كباب" },
];

export function normalizeProductName(raw: string | null | undefined): string {
  return (raw || "")
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

/** Manufactured product key. Retail cuts such as «قطع كباب» stay out. */
export function factoryProductKey(raw: string | null | undefined): string | null {
  const name = normalizeProductName(raw);
  if (!name) return null;
  if (name.includes("كفته") && (name.includes("رز") || name.includes("ارز"))) return "rice_kofta";
  if (name.includes("برجر")) return "burger";
  if (name.includes("سجق")) return "sausage";
  if (name.includes("مفروم")) return "mince";
  if (name.includes("حواوش")) return "hawawshi";
  if (name.includes("شاورما")) return "shawarma";
  if (name.includes("كباب") && !name.includes("قطع")) return "kebab";
  if (name.includes("كفته") || name.includes("كفتة")) return "kofta";
  return null;
}

export function qtyToKg(qty: number, unit: string | null | undefined): number {
  const u = (unit || "").trim().toLowerCase();
  if (u === "طن" || u === "ton" || u === "tons") return qty * 1000;
  return qty;
}

export interface ManufacturingInvoiceRow {
  id: string;
  invoiceNo: string;
  productName: string;
  status: string;
  createdAt: string;
  finishedQty: number;
  unit: string | null;
  rawCost: number;
  spiceCost: number;
  packagingCost: number;
  extraCost: number;
  totalCost: number;
}

export interface MaterialPriceLine {
  invoiceId: string;
  invoiceNo: string;
  productName: string;
  itemName: string;
  kind: string;
  unit: string | null;
  unitCost: number;
  quantity: number;
  createdAt: string;
  invoiceStatus: string;
}

export interface SaleLine {
  productName: string;
  productId: string | null;
  offerName: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  isGift: boolean;
  orderStatus: string;
  createdAt: string;
}

export interface ProfitInvoice {
  id: string;
  invoiceNo: string;
  productName: string;
  status: string;
  createdAt: string;
  kg: number;
  totalCost: number;
}

export interface ProfitRow {
  key: string;
  label: string;
  kg: number;
  tons: number;
  materials: number;
  spices: number;
  packaging: number;
  extra: number;
  totalCost: number;
  costPerKg: number | null;
  costPerTon: number | null;
  soldKg: number;
  salesValue: number;
  sellPerTon: number | null;
  profitPerTon: number | null;
  marginPct: number | null;
  invoices: ProfitInvoice[];
}

export interface OutlierAlert {
  itemName: string;
  kind: string;
  maxUnitCost: number;
  lines: number;
  qtyKg: number;
  invoiceNos: string[];
}

export interface UntransferredInvoice {
  id: string;
  invoiceNo: string;
  productName: string;
  kg: number;
  createdAt: string;
  totalCost: number;
}

export interface FactoryProfitReport {
  rows: ProfitRow[];
  totals: ProfitRow | null;
  outliers: OutlierAlert[];
  untransferred: UntransferredInvoice[];
}

function inRange(iso: string, fromDate: string, toDate: string): boolean {
  const day = toCairoDateString(iso);
  return day >= fromDate && day <= toDate;
}

function perTon(total: number, kg: number): number | null {
  if (!(kg > 0)) return null;
  return (total / kg) * 1000;
}

function margin(sellPerTon: number | null, costPerTon: number | null): { profit: number | null; marginPct: number | null } {
  if (sellPerTon == null || costPerTon == null || !(sellPerTon > 0)) return { profit: null, marginPct: null };
  const profit = sellPerTon - costPerTon;
  return { profit, marginPct: (profit / sellPerTon) * 100 };
}

function emptyBucket(def: FactoryProductDef): ProfitRow {
  return {
    key: def.key,
    label: def.label,
    kg: 0,
    tons: 0,
    materials: 0,
    spices: 0,
    packaging: 0,
    extra: 0,
    totalCost: 0,
    costPerKg: null,
    costPerTon: null,
    soldKg: 0,
    salesValue: 0,
    sellPerTon: null,
    profitPerTon: null,
    marginPct: null,
    invoices: [],
  };
}

function finalize(row: ProfitRow): ProfitRow {
  const kg = row.kg;
  row.tons = kg / 1000;
  row.costPerKg = kg > 0 ? row.totalCost / kg : null;
  row.costPerTon = perTon(row.totalCost, kg);
  row.sellPerTon = perTon(row.salesValue, row.soldKg);
  const m = margin(row.sellPerTon, row.costPerTon);
  row.profitPerTon = m.profit;
  row.marginPct = m.marginPct;
  return row;
}

export function lineSaleValue(line: Pick<SaleLine, "quantity" | "unitPrice" | "totalPrice">): number {
  const total = Number(line.totalPrice);
  if (Number.isFinite(total) && total !== 0) return total;
  return (Number(line.unitPrice) || 0) * (Number(line.quantity) || 0);
}

export function buildFactoryProfitReport(args: {
  invoices: ManufacturingInvoiceRow[];
  lines: MaterialPriceLine[];
  sales: SaleLine[];
  fromDate: string;
  toDate: string;
}): FactoryProfitReport {
  const buckets = new Map(FACTORY_PRODUCTS.map((def) => [def.key, emptyBucket(def)]));

  for (const invoice of args.invoices) {
    if (invoice.status === "cancelled") continue;
    if (!inRange(invoice.createdAt, args.fromDate, args.toDate)) continue;
    const key = factoryProductKey(invoice.productName);
    const bucket = key ? buckets.get(key) : undefined;
    if (!bucket) continue;
    const kg = qtyToKg(Number(invoice.finishedQty) || 0, invoice.unit);
    const parts = (Number(invoice.rawCost) || 0) + (Number(invoice.spiceCost) || 0) + (Number(invoice.packagingCost) || 0) + (Number(invoice.extraCost) || 0);
    const total = Number(invoice.totalCost) > 0 ? Number(invoice.totalCost) : parts;
    bucket.kg += kg;
    bucket.materials += Number(invoice.rawCost) || 0;
    bucket.spices += Number(invoice.spiceCost) || 0;
    bucket.packaging += Number(invoice.packagingCost) || 0;
    bucket.extra += Number(invoice.extraCost) || 0;
    bucket.totalCost += total;
    bucket.invoices.push({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      productName: invoice.productName,
      status: invoice.status,
      createdAt: invoice.createdAt,
      kg,
      totalCost: total,
    });
  }

  for (const sale of args.sales) {
    if (sale.orderStatus === "cancelled" || sale.isGift) continue;
    if (isOfferShippingLine({
      product_id: sale.productId,
      product_name: sale.productName,
      offer_name: sale.offerName,
      quantity: sale.quantity,
      unit_price: sale.unitPrice,
    })) continue;
    if (!inRange(sale.createdAt, args.fromDate, args.toDate)) continue;
    const key = factoryProductKey(sale.productName);
    const bucket = key ? buckets.get(key) : undefined;
    if (!bucket) continue;
    bucket.soldKg += Number(sale.quantity) || 0;
    bucket.salesValue += lineSaleValue(sale);
  }

  const rows = FACTORY_PRODUCTS.map((def) => finalize(buckets.get(def.key)!)).filter(
    (row) => row.kg > 0 || row.soldKg > 0,
  );

  const sold = rows.filter((row) => row.soldKg > 0);
  let totals: ProfitRow | null = null;
  if (sold.length) {
    const produced = sold.filter((row) => row.kg > 0);
    const total: ProfitRow = {
      key: "total",
      label: "الإجمالي (المنتجات المباعة)",
      kg: produced.reduce((s, row) => s + row.kg, 0),
      tons: 0,
      materials: produced.reduce((s, row) => s + row.materials, 0),
      spices: produced.reduce((s, row) => s + row.spices, 0),
      packaging: produced.reduce((s, row) => s + row.packaging, 0),
      extra: produced.reduce((s, row) => s + row.extra, 0),
      totalCost: produced.reduce((s, row) => s + row.totalCost, 0),
      costPerKg: null,
      costPerTon: null,
      soldKg: sold.reduce((s, row) => s + row.soldKg, 0),
      salesValue: sold.reduce((s, row) => s + row.salesValue, 0),
      sellPerTon: null,
      profitPerTon: null,
      marginPct: null,
      invoices: [],
    };
    totals = finalize(total);
  }

  const outlierMap = new Map<string, OutlierAlert>();
  const invoiceById = new Map(args.invoices.map((invoice) => [invoice.id, invoice]));
  for (const line of args.lines) {
    if (line.invoiceStatus === "cancelled") continue;
    if (!(Number(line.unitCost) >= OUTLIER_UNIT_COST_EGP)) continue;
    const invoice = invoiceById.get(line.invoiceId);
    const when = line.createdAt || invoice?.createdAt || "";
    if (when && !inRange(when, args.fromDate, args.toDate)) continue;
    const name = (line.itemName || "").trim();
    let alert = outlierMap.get(name);
    if (!alert) {
      alert = { itemName: name, kind: line.kind, maxUnitCost: 0, lines: 0, qtyKg: 0, invoiceNos: [] };
      outlierMap.set(name, alert);
    }
    alert.lines += 1;
    alert.qtyKg += Number(line.quantity) || 0;
    alert.maxUnitCost = Math.max(alert.maxUnitCost, Number(line.unitCost) || 0);
    const no = line.invoiceNo || invoice?.invoiceNo;
    if (no && !alert.invoiceNos.includes(no) && alert.invoiceNos.length < 8) alert.invoiceNos.push(no);
  }

  const untransferred = args.invoices
    .filter((invoice) => invoice.status === "approved")
    .map((invoice) => ({
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      productName: invoice.productName,
      kg: qtyToKg(Number(invoice.finishedQty) || 0, invoice.unit),
      createdAt: invoice.createdAt,
      totalCost: Number(invoice.totalCost) || 0,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const row of rows) {
    row.invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  return {
    rows,
    totals,
    outliers: [...outlierMap.values()].sort((a, b) => b.maxUnitCost - a.maxUnitCost),
    untransferred,
  };
}
