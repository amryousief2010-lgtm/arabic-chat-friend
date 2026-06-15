// Department Monthly Budget — read-only aggregation across 4 departments
// hatchery / brooding / slaughterhouse / feed_factory
// Includes internal operational values (NOT treasury) + remaining inventory assets
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type DeptKey = "hatchery" | "brooding" | "slaughterhouse" | "feed_factory";
type LineCategory = "cash" | "internal" | "asset";

interface LineItem {
  date: string;
  label: string;
  source: string;
  amount: number;
  category: LineCategory; // cash = real money; internal = operational value; asset = remaining stock value
  reference?: string;
  treasury?: string;
  notes?: string;
  priceSource?: "internal_price" | "avg_cost" | "transfer_unit_price";
}

interface DeptResult {
  key: DeptKey;
  name: string;
  // Totals split
  cashRevenue: number;
  internalValue: number;       // operational internal value (transfers, internal feed supply)
  remainingInventoryValue: number; // remaining stock assets (feed factory)
  expenses: number;
  // Computed
  totalComputedValue: number;  // cash + internal + remaining
  cashNet: number;             // cashRevenue - expenses
  operationalNet: number;      // totalComputedValue - expenses
  expenseRatio: number;        // expenses / totalComputedValue
  status: "profit" | "loss" | "even";          // based on operationalNet
  cashStatus: "profit" | "loss" | "even";      // based on cashNet
  // Items
  revenueItems: LineItem[];    // all positive items (cash + internal + asset)
  expenseItems: LineItem[];
  // Top
  topRevenueSource?: { source: string; amount: number };
  topExpenseItem?: { source: string; amount: number };
  // Pricing alerts
  pricingWarnings: string[];
}

const DEPT_NAMES: Record<DeptKey, string> = {
  hatchery: "معمل التفريخ",
  brooding: "حضانات التسمين",
  slaughterhouse: "المجزر",
  feed_factory: "مصنع العلف",
};

function cairoMonthRange(year: number, month: number): { start: string; end: string } {
  const startD = new Date(Date.UTC(year, month - 1, 1, -2));
  const endD = new Date(Date.UTC(year, month, 1, -2));
  return { start: startD.toISOString(), end: endD.toISOString() };
}
function dateOnlyRange(year: number, month: number): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${year}-${pad(month)}-01`;
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  const end = `${ny}-${pad(nm)}-01`;
  return { start, end };
}

// Pick most recent active internal price effective on/before `onDate` matching name (case-insensitive contains)
function pickPrice(
  rows: Array<{ name: string; price: number; effective_from: string; is_active: boolean }>,
  productName: string,
  onDate: string,
): number | null {
  if (!productName) return null;
  const target = productName.trim().toLowerCase();
  const candidates = rows
    .filter((r) => r.is_active && r.effective_from <= onDate.slice(0, 10))
    .filter((r) => {
      const n = (r.name || "").trim().toLowerCase();
      return n === target || target.includes(n) || n.includes(target);
    })
    .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return candidates[0]?.price ?? null;
}

async function computeMonth(supabase: any, year: number, month: number) {
  const { start: tsStart, end: tsEnd } = cairoMonthRange(year, month);
  const { start: dStart, end: dEnd } = dateOnlyRange(year, month);

  // Pricing tables (small reference data)
  const { data: slPriceRows } = await supabase
    .from("slaughter_internal_prices")
    .select("product_name,price_per_kg,effective_from,is_active");
  const { data: feedPriceRows } = await supabase
    .from("feed_internal_prices")
    .select("feed_name,feed_code,price_per_kg,effective_from,is_active");
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
    .select("invoice_no,client_name_snapshot,issued_at,total_amount,chicks_amount,brooding_amount,infertile_amount,completed_unhatched_amount")
    .gte("issued_at", tsStart).lt("issued_at", tsEnd);
  const { data: hTrx } = await supabase
    .from("hatchery_treasury_txns")
    .select("txn_date,direction,category,amount,notes")
    .gte("txn_date", dStart).lt("txn_date", dEnd);

  const hatchery: DeptResult = mkDept("hatchery");
  for (const inv of hInv ?? []) {
    const parts: Array<[string, number]> = [
      ["رسوم الكتاكيت", Number(inv.chicks_amount || 0)],
      ["رسوم التحضين", Number(inv.brooding_amount || 0)],
      ["رسوم اللايح (المخصب الناقص)", Number(inv.completed_unhatched_amount || 0)],
      ["رسوم الكشف (المخصب غير المخصب)", Number(inv.infertile_amount || 0)],
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
      hatchery.expenses += amt;
      hatchery.expenseItems.push({
        date: t.txn_date, label: t.category || "مصروف",
        source: t.category || "مصروف", amount: amt, category: "cash", notes: t.notes,
      });
    }
  }

  // ============ Brooding ============
  const { data: bSales } = await supabase
    .from("brooding_chick_sales")
    .select("sale_date,customer_name,count,total_amount,sale_method")
    .gte("sale_date", dStart).lt("sale_date", dEnd);
  const { data: bExp } = await supabase
    .from("brooding_expenses")
    .select("expense_date,expense_type,item_name,total_amount,treasury,notes")
    .gte("expense_date", dStart).lt("expense_date", dEnd);
  const { data: bFeed } = await supabase
    .from("brooding_feed_issuance")
    .select("issue_date,feed_name,quantity_kg,total_cost,notes")
    .gte("issue_date", dStart).lt("issue_date", dEnd);

  const brooding: DeptResult = mkDept("brooding");
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
    brooding.expenses += amt;
    brooding.expenseItems.push({
      date: e.expense_date, label: e.item_name || e.expense_type,
      source: e.expense_type || "مصروف", amount: amt, category: "cash",
      treasury: e.treasury, notes: e.notes,
    });
  }
  for (const f of bFeed ?? []) {
    const amt = Number(f.total_cost || 0);
    brooding.expenses += amt;
    brooding.expenseItems.push({
      date: f.issue_date, label: `علف: ${f.feed_name} (${f.quantity_kg} كجم)`,
      source: "علف الحضانات", amount: amt, category: "cash", notes: f.notes,
    });
  }

  // ============ Slaughterhouse ============
  // Internal transfers — these are NOT cash; they are internal operational value
  const { data: sTrans } = await supabase
    .from("slaughter_branch_transfers")
    .select("transferred_at,cut_name_ar,weight_kg,unit_price,total_value")
    .gte("transferred_at", tsStart).lt("transferred_at", tsEnd);
  const { data: sExp } = await supabase
    .from("slaughter_custody_expenses")
    .select("expense_date,category,description,amount,beneficiary,status")
    .gte("expense_date", dStart).lt("expense_date", dEnd);
  const { data: sFeed } = await supabase
    .from("slaughterhouse_feed_movements")
    .select("performed_at,movement_type,quantity_kg,total_cost,notes")
    .gte("performed_at", tsStart).lt("performed_at", tsEnd);

  const slaughter: DeptResult = mkDept("slaughterhouse");
  let slMissingPrice = 0;
  for (const t of sTrans ?? []) {
    const weight = Number(t.weight_kg || 0);
    let unitPrice = Number(t.unit_price || 0);
    let priceSource: LineItem["priceSource"] = "transfer_unit_price";
    if (unitPrice <= 0) {
      const p = pickPrice(slPrices, t.cut_name_ar || "", t.transferred_at);
      if (p && p > 0) { unitPrice = p; priceSource = "internal_price"; }
      else { slMissingPrice++; priceSource = "avg_cost"; }
    } else {
      // override with internal price if defined
      const p = pickPrice(slPrices, t.cut_name_ar || "", t.transferred_at);
      if (p && p > 0) { unitPrice = p; priceSource = "internal_price"; }
    }
    const amt = weight * unitPrice;
    if (amt > 0) {
      slaughter.internalValue += amt;
      slaughter.revenueItems.push({
        date: t.transferred_at, label: `${t.cut_name_ar} (${weight} كجم)`,
        source: "قيمة ناتج ذبح محوّل داخليًا", amount: amt,
        category: "internal", priceSource,
      });
    }
  }
  if (slMissingPrice > 0) {
    slaughter.pricingWarnings.push(
      `${slMissingPrice} تحويل بدون سعر داخلي معتمد — تم استخدام السعر الافتراضي/الصفر`,
    );
  }
  for (const e of sExp ?? []) {
    if (e.status === "rejected") continue;
    const amt = Number(e.amount || 0);
    slaughter.expenses += amt;
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
        slaughter.expenses += amt;
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
    .select("sale_date,sale_no,customer,total_amount,destination_type")
    .gte("sale_date", dStart).lt("sale_date", dEnd);
  const { data: fInternal } = await supabase
    .from("feed_internal_payments")
    .select("payment_date,payment_no,department_type,amount,status")
    .gte("payment_date", dStart).lt("payment_date", dEnd);
  const { data: fPur } = await supabase
    .from("feed_raw_purchases")
    .select("purchase_date,purchase_no,supplier,total_amount,transport_cost,tobacco_cost,other_expense")
    .gte("purchase_date", dStart).lt("purchase_date", dEnd);
  const { data: fTrx } = await supabase
    .from("feed_factory_treasury_txns")
    .select("txn_date,direction,kind,amount,party,note")
    .gte("txn_date", dStart).lt("txn_date", dEnd);
  // Remaining inventory snapshot (asset value as of "now" — not month-specific)
  const { data: fRaw } = await supabase
    .from("feed_raw_materials")
    .select("name,stock,unit_cost,is_active");
  const { data: fProd } = await supabase
    .from("feed_products")
    .select("name,feed_code,current_stock,latest_unit_cost,archived_at");

  const feedF: DeptResult = mkDept("feed_factory");
  let fdMissingPrice = 0;

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
        category: "internal", reference: s.sale_no,
      });
    } else {
      feedF.cashRevenue += amt;
      feedF.revenueItems.push({
        date: s.sale_date, label: `مبيعات علف — ${s.customer || ""}`,
        source: "مبيعات خارجية", amount: amt, category: "cash", reference: s.sale_no,
      });
    }
  }
  for (const p of fInternal ?? []) {
    if (p.status === "rejected") continue;
    const amt = Number(p.amount || 0);
    feedF.internalValue += amt;
    feedF.revenueItems.push({
      date: p.payment_date,
      label: `سداد داخلي — ${p.department_type}`,
      source: "قيمة توريد علف داخلي", amount: amt,
      category: "internal", reference: p.payment_no,
    });
  }
  for (const p of fPur ?? []) {
    const amt = Number(p.total_amount || 0) + Number(p.transport_cost || 0) +
      Number(p.tobacco_cost || 0) + Number(p.other_expense || 0);
    feedF.expenses += amt;
    feedF.expenseItems.push({
      date: p.purchase_date, label: `خامات علف — ${p.supplier || ""}`,
      source: "خامات العلف", amount: amt, category: "cash", reference: p.purchase_no,
    });
  }
  for (const t of fTrx ?? []) {
    if (t.direction === "out" && t.kind !== "raw_purchase") {
      const amt = Number(t.amount || 0);
      feedF.expenses += amt;
      feedF.expenseItems.push({
        date: t.txn_date, label: t.kind || "مصروف",
        source: t.kind || "مصروف", amount: amt, category: "cash",
        treasury: t.party, notes: t.note,
      });
    }
  }

  // Remaining inventory — asset value
  let rawAsset = 0, prodAsset = 0;
  for (const r of fRaw ?? []) {
    if (r.is_active === false) continue;
    const stock = Number(r.stock || 0);
    if (stock <= 0) continue;
    let unit = Number(r.unit_cost || 0);
    let src: LineItem["priceSource"] = "avg_cost";
    const p = pickPrice(feedPrices, r.name || "", dEnd);
    if (p && p > 0) { unit = p; src = "internal_price"; }
    else if (unit <= 0) fdMissingPrice++;
    const value = stock * unit;
    if (value > 0) {
      rawAsset += value;
      feedF.revenueItems.push({
        date: dEnd, label: `مخزون خامات: ${r.name} (${stock})`,
        source: "قيمة مخزون متبقٍ — خامات", amount: value,
        category: "asset", priceSource: src,
      });
    }
  }
  for (const p of fProd ?? []) {
    if (p.archived_at) continue;
    const stock = Number(p.current_stock || 0);
    if (stock <= 0) continue;
    let unit = Number(p.latest_unit_cost || 0);
    let src: LineItem["priceSource"] = "avg_cost";
    const ip = pickPrice(feedPrices, p.name || "", dEnd);
    if (ip && ip > 0) { unit = ip; src = "internal_price"; }
    else if (unit <= 0) fdMissingPrice++;
    const value = stock * unit;
    if (value > 0) {
      prodAsset += value;
      feedF.revenueItems.push({
        date: dEnd, label: `علف جاهز: ${p.name} (${stock})`,
        source: "قيمة مخزون متبقٍ — علف جاهز", amount: value,
        category: "asset", priceSource: src,
      });
    }
  }
  feedF.remainingInventoryValue = rawAsset + prodAsset;
  if (fdMissingPrice > 0) {
    feedF.pricingWarnings.push(
      `${fdMissingPrice} صنف بدون سعر داخلي معتمد — تم استخدام متوسط التكلفة`,
    );
  }

  const depts = [hatchery, brooding, slaughter, feedF];
  for (const d of depts) {
    d.totalComputedValue = d.cashRevenue + d.internalValue + d.remainingInventoryValue;
    d.cashNet = d.cashRevenue - d.expenses;
    d.operationalNet = d.totalComputedValue - d.expenses;
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
  }
  return depts;
}

function mkDept(key: DeptKey): DeptResult {
  return {
    key, name: DEPT_NAMES[key],
    cashRevenue: 0, internalValue: 0, remainingInventoryValue: 0, expenses: 0,
    totalComputedValue: 0, cashNet: 0, operationalNet: 0, expenseRatio: 0,
    status: "even", cashStatus: "even",
    revenueItems: [], expenseItems: [], pricingWarnings: [],
  };
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
      year = Number(body.year);
      month = Number(body.month);
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
        acc.expenses += d.expenses;
        acc.cashNet += d.cashNet;
        acc.operationalNet += d.operationalNet;
        return acc;
      },
      { cashRevenue: 0, internalValue: 0, remainingInventoryValue: 0,
        totalComputedValue: 0, expenses: 0, cashNet: 0, operationalNet: 0 },
    );

    const aggRev = new Map<string, { source: string; dept: string; amount: number; category: LineCategory }>();
    const aggExp = new Map<string, { source: string; dept: string; amount: number }>();
    for (const d of current) {
      for (const i of d.revenueItems) {
        const k = `${d.key}|${i.source}`;
        const cur = aggRev.get(k) || { source: i.source, dept: d.name, amount: 0, category: i.category };
        cur.amount += i.amount;
        aggRev.set(k, cur);
      }
      for (const i of d.expenseItems) {
        const k = `${d.key}|${i.source}`;
        const cur = aggExp.get(k) || { source: i.source, dept: d.name, amount: 0 };
        cur.amount += i.amount;
        aggExp.set(k, cur);
      }
    }
    const topRevenueSources = [...aggRev.values()]
      .sort((a, b) => b.amount - a.amount).slice(0, 15)
      .map(r => ({ ...r, pctOfTotal: totals.totalComputedValue > 0 ? (r.amount / totals.totalComputedValue) * 100 : 0 }));
    const topExpenseItems = [...aggExp.values()]
      .sort((a, b) => b.amount - a.amount).slice(0, 15)
      .map(r => ({ ...r, pctOfTotal: totals.expenses > 0 ? (r.amount / totals.expenses) * 100 : 0 }));

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
        alerts.push({ level: "info", message: `${d.name}: لا يحقق تحصيلًا نقديًا مباشرًا لكنه ينتج قيمة تشغيلية داخلية (صافي تشغيلي +${d.operationalNet.toLocaleString()})` });
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
        alerts.push({ level: "warn", message: `${c.name}: مصروفات الشهر زادت بنسبة ${c.expensesPct.toFixed(0)}% عن الشهر السابق` });
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
        },
        topRevenueSources,
        topExpenseItems,
        comparison,
        alerts,
        meta: {
          note: "القيم التشغيلية الداخلية والأصول المتبقية لا تنشئ أي حركة خزنة — للتحليل فقط",
          treasuryMovementsCreated: 0,
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
