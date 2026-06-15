// Department Monthly Budget — read-only aggregation with real cost-of-production
// Departments: hatchery / brooding / slaughterhouse / feed_factory / meat_factory
// Pulls from manufacturing invoices, slaughter batches, sales lines, finished inventory
// NEVER creates treasury or stock movements.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type DeptKey = "mother_farm" | "hatchery" | "brooding" | "slaughterhouse" | "feed_factory" | "meat_factory";
type LineCategory = "cash" | "internal" | "asset";

interface LineItem {
  date: string;
  label: string;
  source: string;
  amount: number;
  category: LineCategory;
  reference?: string;
  treasury?: string;
  notes?: string;
  priceSource?: "internal_price" | "avg_cost" | "transfer_unit_price" | "production_cost" | "sale_price";
}

interface ProductMetric {
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number; // %
}

interface DeptResult {
  key: DeptKey;
  name: string;
  cashRevenue: number;
  internalValue: number;
  remainingInventoryValue: number;
  productionCost: number;        // cost of producing goods this month
  operatingExpenses: number;     // non-production overhead
  expenses: number;              // = productionCost + operatingExpenses
  totalComputedValue: number;
  cashNet: number;
  operationalNet: number;
  grossMargin: number;
  expenseRatio: number;
  status: "profit" | "loss" | "even";
  cashStatus: "profit" | "loss" | "even";
  revenueItems: LineItem[];
  expenseItems: LineItem[];
  topRevenueSource?: { source: string; amount: number };
  topExpenseItem?: { source: string; amount: number };
  pricingWarnings: string[];
  productMetrics: ProductMetric[];
  topProfitProduct?: ProductMetric;
  topLossProduct?: ProductMetric;
  topCostItem?: { name: string; amount: number };
  // NEW: comparison fields
  actualSaleValue?: number;      // realized sale price when items were actually sold
  costBasisOfOutputs?: number;   // cost basis of items produced/output this month
  opsMetrics?: Record<string, number>; // dept-specific physical metrics (eggs, birds, etc.)
}

const DEPT_NAMES: Record<DeptKey, string> = {
  mother_farm: "مزرعة الأمهات",
  hatchery: "معمل التفريخ",
  brooding: "حضانات التسمين",
  slaughterhouse: "المجزر",
  feed_factory: "مصنع العلف",
  meat_factory: "مصنع اللحوم",
};

function cairoMonthRange(year: number, month: number) {
  const startD = new Date(Date.UTC(year, month - 1, 1, -2));
  const endD = new Date(Date.UTC(year, month, 1, -2));
  return { start: startD.toISOString(), end: endD.toISOString() };
}
function dateOnlyRange(year: number, month: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-01`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return { start, end: `${ny}-${pad(nm)}-01` };
}

function pickPrice(
  rows: Array<{ name: string; price: number; effective_from: string; is_active: boolean }>,
  productName: string, onDate: string,
): number | null {
  if (!productName) return null;
  const target = productName.trim().toLowerCase();
  const c = rows
    .filter(r => r.is_active && r.effective_from <= onDate.slice(0, 10))
    .filter(r => {
      const n = (r.name || "").trim().toLowerCase();
      return n === target || target.includes(n) || n.includes(target);
    })
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return c[0]?.price ?? null;
}

function mkDept(key: DeptKey): DeptResult {
  return {
    key, name: DEPT_NAMES[key],
    cashRevenue: 0, internalValue: 0, remainingInventoryValue: 0,
    productionCost: 0, operatingExpenses: 0, expenses: 0,
    totalComputedValue: 0, cashNet: 0, operationalNet: 0,
    grossMargin: 0, expenseRatio: 0,
    status: "even", cashStatus: "even",
    revenueItems: [], expenseItems: [], pricingWarnings: [],
    productMetrics: [],
  };
}

async function computeMonth(supabase: any, year: number, month: number) {
  const { start: tsStart, end: tsEnd } = cairoMonthRange(year, month);
  const { start: dStart, end: dEnd } = dateOnlyRange(year, month);

  const { data: slPriceRows } = await supabase
    .from("slaughter_internal_prices").select("product_name,price_per_kg,effective_from,is_active");
  const { data: feedPriceRows } = await supabase
    .from("feed_internal_prices").select("feed_name,price_per_kg,effective_from,is_active");
  const slPrices = (slPriceRows ?? []).map((r: any) => ({
    name: r.product_name, price: Number(r.price_per_kg || 0),
    effective_from: r.effective_from, is_active: r.is_active,
  }));
  const feedPrices = (feedPriceRows ?? []).map((r: any) => ({
    name: r.feed_name, price: Number(r.price_per_kg || 0),
    effective_from: r.effective_from, is_active: r.is_active,
  }));

  // ============ Hatchery ============
  const { data: hInv } = await supabase
    .from("hatchery_client_invoices")
    .select("invoice_no,client_name_snapshot,issued_at,chicks_amount,brooding_amount,infertile_amount,completed_unhatched_amount")
    .gte("issued_at", tsStart).lt("issued_at", tsEnd);
  const { data: hTrx } = await supabase
    .from("hatchery_treasury_txns")
    .select("txn_date,direction,category,amount,notes")
    .gte("txn_date", dStart).lt("txn_date", dEnd);
  const hatchery = mkDept("hatchery");
  for (const inv of hInv ?? []) {
    const parts: Array<[string, number]> = [
      ["رسوم الكتاكيت", Number(inv.chicks_amount || 0)],
      ["رسوم التحضين", Number(inv.brooding_amount || 0)],
      ["رسوم اللايح", Number(inv.completed_unhatched_amount || 0)],
      ["رسوم الكشف", Number(inv.infertile_amount || 0)],
    ];
    for (const [label, amt] of parts) {
      if (amt > 0) {
        hatchery.cashRevenue += amt;
        hatchery.revenueItems.push({
          date: inv.issued_at, label, source: label, amount: amt,
          category: "cash", reference: inv.invoice_no, treasury: inv.client_name_snapshot,
        });
      }
    }
  }
  for (const t of hTrx ?? []) {
    if (t.direction === "out") {
      const amt = Number(t.amount || 0);
      hatchery.operatingExpenses += amt;
      hatchery.expenseItems.push({
        date: t.txn_date, label: t.category || "مصروف",
        source: t.category || "مصروف", amount: amt, category: "cash", notes: t.notes,
      });
    }
  }

  // ============ Brooding ============
  const { data: bSales } = await supabase
    .from("brooding_chick_sales")
    .select("sale_date,customer_name,count,total_amount")
    .gte("sale_date", dStart).lt("sale_date", dEnd);
  const { data: bExp } = await supabase
    .from("brooding_expenses")
    .select("expense_date,expense_type,item_name,total_amount,treasury,notes")
    .gte("expense_date", dStart).lt("expense_date", dEnd);
  const { data: bFeed } = await supabase
    .from("brooding_feed_issuance")
    .select("issue_date,feed_name,quantity_kg,total_cost,notes")
    .gte("issue_date", dStart).lt("issue_date", dEnd);
  const brooding = mkDept("brooding");
  for (const s of bSales ?? []) {
    const amt = Number(s.total_amount || 0);
    brooding.cashRevenue += amt;
    brooding.revenueItems.push({
      date: s.sale_date, label: `مبيعات كتاكيت (${s.count})`,
      source: "مبيعات كتاكيت", amount: amt, category: "cash", treasury: s.customer_name,
    });
  }
  for (const e of bExp ?? []) {
    const amt = Number(e.total_amount || 0);
    brooding.operatingExpenses += amt;
    brooding.expenseItems.push({
      date: e.expense_date, label: e.item_name || e.expense_type,
      source: e.expense_type || "مصروف", amount: amt, category: "cash",
      treasury: e.treasury, notes: e.notes,
    });
  }
  for (const f of bFeed ?? []) {
    const amt = Number(f.total_cost || 0);
    brooding.productionCost += amt; // feed cost is operational input
    brooding.expenseItems.push({
      date: f.issue_date, label: `علف: ${f.feed_name} (${f.quantity_kg} كجم)`,
      source: "علف الحضانات", amount: amt, category: "cash", notes: f.notes,
    });
  }

  // ============ Slaughterhouse ============
  const { data: sBatches } = await supabase
    .from("slaughter_batches")
    .select("id,batch_number,slaughter_date,total_meat_kg,cost_per_kg_meat,birds_slaughtered,total_live_weight_kg")
    .gte("slaughter_date", dStart).lt("slaughter_date", dEnd);
  const sBatchIds = (sBatches ?? []).map((b: any) => b.id);
  const { data: sOutputs } = sBatchIds.length
    ? await supabase
        .from("slaughter_batch_outputs")
        .select("batch_id,cut_name_ar,actual_weight_kg,unit_cost,total_cost,unit_price,destination,created_at,received_status")
        .in("batch_id", sBatchIds)
    : { data: [] };
  const { data: sTrans } = await supabase
    .from("slaughter_branch_transfers")
    .select("transferred_at,cut_name_ar,weight_kg,unit_price,total_value,status")
    .gte("transferred_at", tsStart).lt("transferred_at", tsEnd);
  const { data: sExp } = await supabase
    .from("slaughter_custody_expenses")
    .select("expense_date,category,description,amount,beneficiary,status")
    .gte("expense_date", dStart).lt("expense_date", dEnd);
  const { data: sFeed } = await supabase
    .from("slaughterhouse_feed_movements")
    .select("performed_at,movement_type,quantity_kg,total_cost,notes")
    .gte("performed_at", tsStart).lt("performed_at", tsEnd);

  const slaughter = mkDept("slaughterhouse");
  // Production cost from slaughter batches (when cost_per_kg_meat populated)
  let totalMeatKg = 0, totalBirds = 0, totalLiveKg = 0;
  for (const b of sBatches ?? []) {
    const meat = Number(b.total_meat_kg || 0);
    const cpk = Number(b.cost_per_kg_meat || 0);
    totalMeatKg += meat;
    totalBirds += Number(b.birds_slaughtered || 0);
    totalLiveKg += Number(b.total_live_weight_kg || 0);
    if (cpk > 0 && meat > 0) {
      const cost = cpk * meat;
      slaughter.productionCost += cost;
      slaughter.expenseItems.push({
        date: b.slaughter_date, label: `دفعة دبح ${b.batch_number} — ${meat} كجم × ${cpk} ج/كجم`,
        source: "تكلفة الدبح المباشرة", amount: cost, category: "cash",
        priceSource: "production_cost",
      });
    }
  }
  // Internal value: prefer branch_transfers (signed by receiver), fall back to batch outputs
  const transferredKeys = new Set(
    (sTrans ?? []).map((t: any) => `${(t.cut_name_ar || "").trim()}|${(t.transferred_at || "").slice(0, 10)}`),
  );
  for (const t of sTrans ?? []) {
    if (t.status === "rejected") continue;
    const weight = Number(t.weight_kg || 0);
    let unitPrice = Number(t.unit_price || 0);
    let priceSource: LineItem["priceSource"] = "transfer_unit_price";
    const p = pickPrice(slPrices, t.cut_name_ar || "", t.transferred_at);
    if (p && p > 0) { unitPrice = p; priceSource = "internal_price"; }
    else if (unitPrice <= 0) { priceSource = "avg_cost"; }
    const amt = weight * unitPrice;
    if (amt > 0) {
      slaughter.internalValue += amt;
      slaughter.revenueItems.push({
        date: t.transferred_at, label: `${t.cut_name_ar} (${weight} كجم) — تحويل`,
        source: "قيمة ناتج ذبح محوّل داخليًا", amount: amt,
        category: "internal", priceSource,
      });
    }
  }
  // Outputs without matching transfer: count by cost basis (avoid double-count)
  let missingOutPrice = 0;
  for (const o of sOutputs ?? []) {
    const key = `${(o.cut_name_ar || "").trim()}|${(o.created_at || "").slice(0, 10)}`;
    if (transferredKeys.has(key)) continue;
    const weight = Number(o.actual_weight_kg || 0);
    let unitPrice = Number(o.unit_price || 0);
    let priceSource: LineItem["priceSource"] = "transfer_unit_price";
    const p = pickPrice(slPrices, o.cut_name_ar || "", o.created_at);
    if (p && p > 0) { unitPrice = p; priceSource = "internal_price"; }
    else if (unitPrice <= 0) {
      unitPrice = Number(o.unit_cost || 0);
      if (unitPrice <= 0) { missingOutPrice++; continue; }
      priceSource = "production_cost";
    }
    const amt = weight * unitPrice;
    if (amt > 0) {
      slaughter.internalValue += amt;
      slaughter.revenueItems.push({
        date: o.created_at, label: `${o.cut_name_ar} (${weight} كجم) — ناتج دبح`,
        source: "قيمة ناتج ذبح محوّل داخليًا", amount: amt,
        category: "internal", priceSource,
      });
    }
  }
  if (missingOutPrice > 0) {
    slaughter.pricingWarnings.push(`${missingOutPrice} ناتج دبح بدون تكلفة وحدة معتمدة`);
  }
  for (const e of sExp ?? []) {
    if (e.status === "rejected") continue;
    const amt = Number(e.amount || 0);
    slaughter.operatingExpenses += amt;
    slaughter.expenseItems.push({
      date: e.expense_date, label: e.description || e.category,
      source: e.category || "عهدة المجزر", amount: amt, category: "cash",
      treasury: e.beneficiary,
    });
  }
  for (const f of sFeed ?? []) {
    if (f.movement_type !== "in") {
      const amt = Number(f.total_cost || 0);
      if (amt > 0) {
        slaughter.productionCost += amt; // feed is direct input
        slaughter.expenseItems.push({
          date: f.performed_at, label: `علف المجزر (${f.quantity_kg} كجم)`,
          source: "علف المجزر", amount: amt, category: "cash", notes: f.notes,
        });
      }
    }
  }

  // ============ Feed Factory ============
  const { data: fSales } = await supabase
    .from("feed_sales")
    .select("sale_date,sale_no,customer,total_amount,total_cost,profit,destination_type")
    .gte("sale_date", dStart).lt("sale_date", dEnd);
  const { data: fInternal } = await supabase
    .from("feed_internal_payments")
    .select("payment_date,payment_no,department_type,amount,status")
    .gte("payment_date", dStart).lt("payment_date", dEnd);
  const { data: fProdInv } = await supabase
    .from("feed_production_invoices")
    .select("prod_no,prod_date,qty_produced,total_cost,unit_cost,labor_cost,product_id")
    .gte("prod_date", dStart).lt("prod_date", dEnd);
  const { data: fProducts } = await supabase
    .from("feed_products")
    .select("id,name,feed_code,current_stock,latest_unit_cost,archived_at");
  const { data: fTrx } = await supabase
    .from("feed_factory_treasury_txns")
    .select("txn_date,direction,kind,amount,party,note")
    .gte("txn_date", dStart).lt("txn_date", dEnd);
  const { data: fRaw } = await supabase
    .from("feed_raw_materials")
    .select("name,stock,unit_cost,is_active");

  const feedF = mkDept("feed_factory");
  const feedProductMap = new Map<string, any>((fProducts ?? []).map((p: any) => [p.id, p]));

  // Production cost from manufacturing invoices (this IS the cost of producing feed this month)
  for (const inv of fProdInv ?? []) {
    const cost = Number(inv.total_cost || 0);
    const qty = Number(inv.qty_produced || 0);
    const unit = Number(inv.unit_cost || (qty > 0 ? cost / qty : 0));
    if (cost > 0) {
      feedF.productionCost += cost;
      const prod = feedProductMap.get(inv.product_id);
      feedF.expenseItems.push({
        date: inv.prod_date,
        label: `تصنيع علف ${prod?.name || ""} — ${qty} كجم × ${unit.toFixed(2)} ج/كجم`,
        source: "تكلفة تصنيع العلف", amount: cost, category: "cash",
        reference: inv.prod_no, priceSource: "production_cost",
      });
    }
  }

  // Sales: split cash vs internal
  for (const s of fSales ?? []) {
    const amt = Number(s.total_amount || 0);
    if (amt <= 0) continue;
    const isInternal = s.destination_type && s.destination_type !== "external_customer";
    if (isInternal) {
      feedF.internalValue += amt;
      feedF.revenueItems.push({
        date: s.sale_date,
        label: `توريد علف داخلي — ${s.customer || s.destination_type}`,
        source: "قيمة توريد علف داخلي", amount: amt,
        category: "internal", reference: s.sale_no, priceSource: "sale_price",
      });
    } else {
      feedF.cashRevenue += amt;
      feedF.revenueItems.push({
        date: s.sale_date, label: `مبيعات علف — ${s.customer || ""}`,
        source: "مبيعات خارجية", amount: amt, category: "cash",
        reference: s.sale_no, priceSource: "sale_price",
      });
    }
  }
  for (const p of fInternal ?? []) {
    if (p.status === "rejected") continue;
    const amt = Number(p.amount || 0);
    feedF.internalValue += amt;
    feedF.revenueItems.push({
      date: p.payment_date, label: `سداد داخلي — ${p.department_type}`,
      source: "قيمة توريد علف داخلي", amount: amt,
      category: "internal", reference: p.payment_no,
    });
  }
  // Operating expenses: non-production treasury outflows (skip raw_purchase to avoid double-count with production invoices)
  for (const t of fTrx ?? []) {
    if (t.direction === "out" && t.kind !== "raw_purchase") {
      const amt = Number(t.amount || 0);
      feedF.operatingExpenses += amt;
      feedF.expenseItems.push({
        date: t.txn_date, label: t.kind || "مصروف",
        source: t.kind || "مصروف", amount: amt, category: "cash",
        treasury: t.party, notes: t.note,
      });
    }
  }
  // Remaining inventory — asset value
  let fdMissingPrice = 0, rawAsset = 0, prodAsset = 0;
  for (const r of fRaw ?? []) {
    if (r.is_active === false) continue;
    const stock = Number(r.stock || 0);
    if (stock <= 0) continue;
    let unit = Number(r.unit_cost || 0);
    let src: LineItem["priceSource"] = "avg_cost";
    const p = pickPrice(feedPrices, r.name || "", dEnd);
    if (p && p > 0) { unit = p; src = "internal_price"; }
    else if (unit <= 0) fdMissingPrice++;
    const v = stock * unit;
    if (v > 0) {
      rawAsset += v;
      feedF.revenueItems.push({
        date: dEnd, label: `مخزون خامات: ${r.name} (${stock})`,
        source: "قيمة مخزون متبقٍ — خامات", amount: v,
        category: "asset", priceSource: src,
      });
    }
  }
  for (const p of fProducts ?? []) {
    if (p.archived_at) continue;
    const stock = Number(p.current_stock || 0);
    if (stock <= 0) continue;
    let unit = Number(p.latest_unit_cost || 0);
    let src: LineItem["priceSource"] = "production_cost";
    const ip = pickPrice(feedPrices, p.name || "", dEnd);
    if (ip && ip > 0) { unit = ip; src = "internal_price"; }
    else if (unit <= 0) fdMissingPrice++;
    const v = stock * unit;
    if (v > 0) {
      prodAsset += v;
      feedF.revenueItems.push({
        date: dEnd, label: `علف جاهز: ${p.name} (${stock})`,
        source: "قيمة مخزون متبقٍ — علف جاهز", amount: v,
        category: "asset", priceSource: src,
      });
    }
  }
  feedF.remainingInventoryValue = rawAsset + prodAsset;
  if (fdMissingPrice > 0) {
    feedF.pricingWarnings.push(`${fdMissingPrice} صنف بدون سعر داخلي معتمد — استخدام متوسط التكلفة`);
  }
  // Feed product profitability (from feed_sales.total_cost and profit if present)
  const feedSalesProfit = (fSales ?? []).reduce((acc: number, s: any) => acc + Number(s.profit || 0), 0);
  const feedSalesCost = (fSales ?? []).reduce((acc: number, s: any) => acc + Number(s.total_cost || 0), 0);
  if (feedSalesCost > 0) {
    // proxy product line — feed has no per-product sale split here
    feedF.productMetrics.push({
      name: "مبيعات العلف المباشرة",
      qty: 0,
      revenue: feedF.cashRevenue + feedF.internalValue,
      cost: feedSalesCost,
      profit: feedSalesProfit,
      margin: feedSalesProfit && (feedSalesCost + feedSalesProfit) > 0
        ? (feedSalesProfit / (feedSalesCost + feedSalesProfit)) * 100 : 0,
    });
  }

  // ============ Meat Factory (NEW) ============
  const meatF = mkDept("meat_factory");
  // Production cost from both manufacturing tables
  const { data: mManu } = await supabase
    .from("meat_manufacturing_invoices")
    .select("invoice_no,created_at,product_name,finished_qty,total_manufacturing_cost,materials_total_cost,raw_cost,spice_cost,packaging_cost,extra_cost,unit_cost,status")
    .gte("created_at", tsStart).lt("created_at", tsEnd);
  const { data: mManu2 } = await supabase
    .from("mf_manufacturing")
    .select("invoice_no,invoice_date,finished_id,produced_qty,raw_cost,pack_cost,extra_cost,total_cost,unit_cost,status,is_test")
    .gte("invoice_date", dStart).lt("invoice_date", dEnd);
  // Sales
  const { data: mSales } = await supabase
    .from("meat_factory_sales")
    .select("id,invoice_number,sale_date,customer,total_amount,status")
    .gte("sale_date", dStart).lt("sale_date", dEnd);
  const mSalesIds = (mSales ?? []).map((s: any) => s.id);
  const { data: mSalesLines } = mSalesIds.length
    ? await supabase.from("meat_factory_sales_lines")
        .select("sale_id,finished_item_name,quantity,unit_price,unit_cost_snapshot,line_total")
        .in("sale_id", mSalesIds)
    : { data: [] };
  const { data: mSales2 } = await supabase
    .from("mf_sales")
    .select("id,invoice_no,invoice_date,customer,total_amount,total_cost,profit,status,is_test")
    .gte("invoice_date", dStart).lt("invoice_date", dEnd);
  const mSales2Ids = (mSales2 ?? []).map((s: any) => s.id);
  const { data: mSales2Lines } = mSales2Ids.length
    ? await supabase.from("mf_sales_lines")
        .select("sale_id,finished_id,qty,unit_price,cost_snapshot,total")
        .in("sale_id", mSales2Ids)
    : { data: [] };
  // Finished + raw inventory
  const { data: mFinished } = await supabase
    .from("meat_finished_inventory")
    .select("name_ar,stock,avg_prod_cost,is_active");
  const { data: mRaw } = await supabase
    .from("meat_raw_inventory")
    .select("name_ar,stock,avg_cost,is_active");
  // Treasury (operating expenses)
  const { data: mTrx } = await supabase
    .from("meat_factory_treasury_txns")
    .select("created_at,kind,amount,party,note");

  // Production cost
  for (const m of mManu ?? []) {
    if (m.status && m.status !== "posted" && m.status !== "transferred") continue;
    const cost = Number(m.total_manufacturing_cost || m.materials_total_cost || 0);
    if (cost <= 0) continue;
    meatF.productionCost += cost;
    meatF.expenseItems.push({
      date: m.created_at, label: `تصنيع ${m.product_name} — ${m.finished_qty} ${""}`,
      source: "تكلفة تصنيع اللحوم", amount: cost, category: "cash",
      reference: m.invoice_no, priceSource: "production_cost",
    });
  }
  for (const m of mManu2 ?? []) {
    if (m.status !== "posted") continue;
    const cost = Number(m.total_cost || 0);
    if (cost <= 0) continue;
    meatF.productionCost += cost;
    meatF.expenseItems.push({
      date: m.invoice_date, label: `تصنيع منتج — ${m.produced_qty} وحدة`,
      source: "تكلفة تصنيع اللحوم", amount: cost, category: "cash",
      reference: m.invoice_no, priceSource: "production_cost",
    });
  }
  // Sales (cash revenue) + per-product profitability
  const productAgg = new Map<string, ProductMetric>();
  const linesBySale = new Map<string, any[]>();
  for (const l of (mSalesLines ?? []) as any[]) {
    const arr = linesBySale.get(l.sale_id) || [];
    arr.push(l); linesBySale.set(l.sale_id, arr);
  }
  for (const s of mSales ?? []) {
    if (s.status && s.status !== "posted") continue;
    const amt = Number(s.total_amount || 0);
    if (amt > 0) {
      meatF.cashRevenue += amt;
      meatF.revenueItems.push({
        date: s.sale_date, label: `مبيعات لحوم — ${s.customer || ""}`,
        source: "مبيعات مصنع اللحوم", amount: amt, category: "cash",
        reference: s.invoice_number, priceSource: "sale_price",
      });
    }
    for (const l of linesBySale.get(s.id) || []) {
      const name = l.finished_item_name || "غير معروف";
      const qty = Number(l.quantity || 0);
      const rev = Number(l.line_total || 0);
      const cost = qty * Number(l.unit_cost_snapshot || 0);
      const cur = productAgg.get(name) || { name, qty: 0, revenue: 0, cost: 0, profit: 0, margin: 0 };
      cur.qty += qty; cur.revenue += rev; cur.cost += cost;
      productAgg.set(name, cur);
    }
  }
  const lines2BySale = new Map<string, any[]>();
  for (const l of (mSales2Lines ?? []) as any[]) {
    const arr = lines2BySale.get(l.sale_id) || [];
    arr.push(l); lines2BySale.set(l.sale_id, arr);
  }
  const finishedMap = new Map<string, any>((mFinished ?? []).map((f: any) => [f.name_ar?.toLowerCase().trim(), f]));
  for (const s of mSales2 ?? []) {
    if (s.status !== "posted") continue;
    if (s.is_test) continue;
    const amt = Number(s.total_amount || 0);
    if (amt > 0) {
      meatF.cashRevenue += amt;
      meatF.revenueItems.push({
        date: s.invoice_date, label: `مبيعات لحوم — ${s.customer || ""}`,
        source: "مبيعات مصنع اللحوم", amount: amt, category: "cash",
        reference: s.invoice_no, priceSource: "sale_price",
      });
    }
    for (const l of lines2BySale.get(s.id) || []) {
      const name = `صنف ${(l.finished_id || "").slice(0, 8)}`;
      const qty = Number(l.qty || 0);
      const rev = Number(l.total || 0);
      const cost = qty * Number(l.cost_snapshot || 0);
      const cur = productAgg.get(name) || { name, qty: 0, revenue: 0, cost: 0, profit: 0, margin: 0 };
      cur.qty += qty; cur.revenue += rev; cur.cost += cost;
      productAgg.set(name, cur);
    }
  }
  meatF.productMetrics = [...productAgg.values()].map(p => {
    p.profit = p.revenue - p.cost;
    p.margin = p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0;
    return p;
  }).sort((a, b) => b.profit - a.profit);

  // Operating expenses (treasury outflows — kind != raw_purchase)
  const mTrxFiltered = (mTrx ?? []).filter((t: any) => {
    const d = t.created_at?.slice(0, 10);
    return d && d >= dStart && d < dEnd;
  });
  for (const t of mTrxFiltered) {
    const amt = Number(t.amount || 0);
    if (amt <= 0) continue;
    if (t.kind === "raw_purchase") continue;
    meatF.operatingExpenses += amt;
    meatF.expenseItems.push({
      date: t.created_at, label: t.kind || "مصروف",
      source: t.kind || "مصروف", amount: amt, category: "cash",
      treasury: t.party, notes: t.note,
    });
  }
  // Remaining inventory
  let mAsset = 0;
  for (const f of mFinished ?? []) {
    if (f.is_active === false) continue;
    const stock = Number(f.stock || 0);
    const unit = Number(f.avg_prod_cost || 0);
    if (stock > 0 && unit > 0) {
      const v = stock * unit; mAsset += v;
      meatF.revenueItems.push({
        date: dEnd, label: `منتج نهائي: ${f.name_ar} (${stock})`,
        source: "قيمة مخزون متبقٍ — منتج نهائي", amount: v,
        category: "asset", priceSource: "production_cost",
      });
    }
  }
  for (const r of mRaw ?? []) {
    if (r.is_active === false) continue;
    const stock = Number(r.stock || 0);
    const unit = Number(r.avg_cost || 0);
    if (stock > 0 && unit > 0) {
      const v = stock * unit; mAsset += v;
      meatF.revenueItems.push({
        date: dEnd, label: `خامة لحوم: ${r.name_ar} (${stock})`,
        source: "قيمة مخزون متبقٍ — خامات", amount: v,
        category: "asset", priceSource: "avg_cost",
      });
    }
  }
  meatF.remainingInventoryValue = mAsset;

  // ============ Finalize ============
  const depts = [hatchery, brooding, slaughter, feedF, meatF];
  for (const d of depts) {
    d.expenses = d.productionCost + d.operatingExpenses;
    d.totalComputedValue = d.cashRevenue + d.internalValue + d.remainingInventoryValue;
    d.cashNet = d.cashRevenue - d.expenses;
    d.operationalNet = d.totalComputedValue - d.expenses;
    const sales = d.cashRevenue + d.internalValue;
    d.grossMargin = sales > 0 ? ((sales - d.productionCost) / sales) * 100 : 0;
    d.expenseRatio = d.totalComputedValue > 0 ? (d.expenses / d.totalComputedValue) * 100 : 0;
    d.status = d.operationalNet > 0 ? "profit" : d.operationalNet < 0 ? "loss" : "even";
    d.cashStatus = d.cashNet > 0 ? "profit" : d.cashNet < 0 ? "loss" : "even";
    const groupBy = (arr: LineItem[]) => {
      const m = new Map<string, number>();
      for (const i of arr) m.set(i.source, (m.get(i.source) || 0) + i.amount);
      return [...m.entries()].map(([source, amount]) => ({ source, amount }))
        .sort((a, b) => b.amount - a.amount);
    };
    d.topRevenueSource = groupBy(d.revenueItems)[0];
    d.topExpenseItem = groupBy(d.expenseItems)[0];
    d.topCostItem = d.topExpenseItem ? { name: d.topExpenseItem.source, amount: d.topExpenseItem.amount } : undefined;
    if (d.productMetrics.length) {
      d.topProfitProduct = d.productMetrics[0];
      d.topLossProduct = d.productMetrics[d.productMetrics.length - 1];
    }
  }
  return depts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let year: number, month: number;
    if (req.method === "POST") {
      const body = await req.json();
      year = Number(body.year); month = Number(body.month);
    } else {
      const url = new URL(req.url);
      year = Number(url.searchParams.get("year"));
      month = Number(url.searchParams.get("month"));
    }
    if (!year || !month || month < 1 || month > 12) {
      return new Response(JSON.stringify({ error: "year and month (1-12) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const current = await computeMonth(supabase, year, month);
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const previous = await computeMonth(supabase, prevYear, prevMonth);

    const totals = current.reduce(
      (acc, d) => {
        acc.cashRevenue += d.cashRevenue;
        acc.internalValue += d.internalValue;
        acc.remainingInventoryValue += d.remainingInventoryValue;
        acc.totalComputedValue += d.totalComputedValue;
        acc.productionCost += d.productionCost;
        acc.operatingExpenses += d.operatingExpenses;
        acc.expenses += d.expenses;
        acc.cashNet += d.cashNet;
        acc.operationalNet += d.operationalNet;
        return acc;
      },
      { cashRevenue: 0, internalValue: 0, remainingInventoryValue: 0,
        totalComputedValue: 0, productionCost: 0, operatingExpenses: 0, expenses: 0,
        cashNet: 0, operationalNet: 0 },
    );

    const aggRev = new Map<string, any>();
    const aggExp = new Map<string, any>();
    for (const d of current) {
      for (const i of d.revenueItems) {
        const k = `${d.key}|${i.source}`;
        const cur = aggRev.get(k) || { source: i.source, dept: d.name, amount: 0, category: i.category };
        cur.amount += i.amount; aggRev.set(k, cur);
      }
      for (const i of d.expenseItems) {
        const k = `${d.key}|${i.source}`;
        const cur = aggExp.get(k) || { source: i.source, dept: d.name, amount: 0 };
        cur.amount += i.amount; aggExp.set(k, cur);
      }
    }
    const topRevenueSources = [...aggRev.values()]
      .sort((a, b) => b.amount - a.amount).slice(0, 15)
      .map(r => ({ ...r, pctOfTotal: totals.totalComputedValue > 0 ? (r.amount / totals.totalComputedValue) * 100 : 0 }));
    const topExpenseItems = [...aggExp.values()]
      .sort((a, b) => b.amount - a.amount).slice(0, 15)
      .map(r => ({ ...r, pctOfTotal: totals.expenses > 0 ? (r.amount / totals.expenses) * 100 : 0 }));

    // Cross-dept top profitable / losing products
    const allProducts: Array<ProductMetric & { dept: string }> = [];
    for (const d of current) {
      for (const p of d.productMetrics) allProducts.push({ ...p, dept: d.name });
    }
    const topProfitProducts = [...allProducts].sort((a, b) => b.profit - a.profit).slice(0, 10);
    const topLossProducts = [...allProducts].sort((a, b) => a.profit - b.profit)
      .filter(p => p.profit < 0).slice(0, 10);

    const profitable = [...current].sort((a, b) => b.operationalNet - a.operationalNet);
    const mostProfit = profitable[0];
    const mostLoss = profitable[profitable.length - 1];
    const byRev = [...current].sort((a, b) => b.totalComputedValue - a.totalComputedValue)[0];
    const byExp = [...current].sort((a, b) => b.expenses - a.expenses)[0];

    const comparison = current.map(d => {
      const prev = previous.find(p => p.key === d.key)!;
      return {
        key: d.key, name: d.name,
        currentNet: d.operationalNet, previousNet: prev.operationalNet,
        currentCashNet: d.cashNet, previousCashNet: prev.cashNet,
        currentRevenue: d.totalComputedValue, previousRevenue: prev.totalComputedValue,
        currentExpenses: d.expenses, previousExpenses: prev.expenses,
        revenueDelta: d.totalComputedValue - prev.totalComputedValue,
        expensesDelta: d.expenses - prev.expenses,
        netDelta: d.operationalNet - prev.operationalNet,
        revenuePct: prev.totalComputedValue > 0 ? ((d.totalComputedValue - prev.totalComputedValue) / prev.totalComputedValue) * 100 : null,
        expensesPct: prev.expenses > 0 ? ((d.expenses - prev.expenses) / prev.expenses) * 100 : null,
      };
    });

    const alerts: { level: "warn" | "danger" | "info"; message: string }[] = [];
    for (const d of current) {
      if (d.status === "loss") {
        alerts.push({ level: "danger", message: `${d.name}: خسارة تشغيلية بقيمة ${Math.abs(d.operationalNet).toLocaleString()} ج.م` });
      } else if (d.cashStatus === "loss" && d.status !== "loss") {
        alerts.push({ level: "info", message: `${d.name}: لا يحقق تحصيلًا نقديًا مباشرًا لكنه ينتج قيمة تشغيلية داخلية (+${d.operationalNet.toLocaleString()})` });
      }
      if (d.expenseRatio > 100) {
        alerts.push({ level: "danger", message: `${d.name}: المصروفات أعلى من إجمالي القيمة (${d.expenseRatio.toFixed(0)}%)` });
      } else if (d.expenseRatio > 85 && d.totalComputedValue > 0) {
        alerts.push({ level: "warn", message: `${d.name}: نسبة المصروفات مرتفعة (${d.expenseRatio.toFixed(0)}%)` });
      }
      for (const w of d.pricingWarnings) {
        alerts.push({ level: "warn", message: `${d.name}: ${w}` });
      }
    }
    for (const c of comparison) {
      if (c.expensesPct != null && c.expensesPct > 25) {
        alerts.push({ level: "warn", message: `${c.name}: مصروفات الشهر زادت بنسبة ${c.expensesPct.toFixed(0)}%` });
      }
    }

    return new Response(
      JSON.stringify({
        year, month,
        departments: current,
        previous,
        totals,
        highlights: {
          mostProfit: mostProfit && { key: mostProfit.key, name: mostProfit.name, net: mostProfit.operationalNet },
          mostLoss: mostLoss && { key: mostLoss.key, name: mostLoss.name, net: mostLoss.operationalNet },
          topRevenueDept: byRev && { key: byRev.key, name: byRev.name, revenue: byRev.totalComputedValue },
          topExpenseDept: byExp && { key: byExp.key, name: byExp.name, expenses: byExp.expenses },
          biggestRevenueSource: topRevenueSources[0],
          biggestExpenseItem: topExpenseItems[0],
          topProfitProduct: topProfitProducts[0],
          topLossProduct: topLossProducts[0],
        },
        topRevenueSources,
        topExpenseItems,
        topProfitProducts,
        topLossProducts,
        comparison,
        alerts,
        meta: {
          note: "تكلفة الإنتاج من فواتير التصنيع الفعلية + سعر البيع الفعلي من فواتير المبيعات. القيم التشغيلية والأصول لا تنشئ أي حركة خزنة.",
          treasuryMovementsCreated: 0,
          usedActualProductionCost: true,
          usedActualSalePrice: true,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("dept-budget error", err);
    return new Response(JSON.stringify({ error: String((err as any)?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
