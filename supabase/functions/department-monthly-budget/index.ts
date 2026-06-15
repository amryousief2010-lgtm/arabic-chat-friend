// Department Monthly Budget — read-only aggregation across 4 departments
// hatchery / brooding / slaughterhouse / feed_factory
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type DeptKey = "hatchery" | "brooding" | "slaughterhouse" | "feed_factory";

interface LineItem {
  date: string;
  label: string;
  source: string;
  amount: number;
  reference?: string;
  treasury?: string;
  notes?: string;
}

interface DeptResult {
  key: DeptKey;
  name: string;
  revenue: number;
  expenses: number;
  net: number;
  expenseRatio: number;
  status: "profit" | "loss" | "even";
  revenueItems: LineItem[];
  expenseItems: LineItem[];
  topRevenueSource?: { source: string; amount: number };
  topExpenseItem?: { source: string; amount: number };
}

const DEPT_NAMES: Record<DeptKey, string> = {
  hatchery: "معمل التفريخ",
  brooding: "حضانات التسمين",
  slaughterhouse: "المجزر",
  feed_factory: "مصنع العلف",
};

function cairoMonthRange(year: number, month: number): { start: string; end: string } {
  // month is 1-12. Use simple UTC range for date columns; for timestamptz cols,
  // shift by Cairo offset (use +02:00 worst-case — acceptable for monthly buckets).
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

async function computeMonth(supabase: any, year: number, month: number) {
  const { start: tsStart, end: tsEnd } = cairoMonthRange(year, month);
  const { start: dStart, end: dEnd } = dateOnlyRange(year, month);

  // ============ Hatchery ============
  const { data: hInv } = await supabase
    .from("hatchery_client_invoices")
    .select("invoice_no,client_name_snapshot,issued_at,total_amount,chicks_amount,brooding_amount,infertile_amount,completed_unhatched_amount")
    .gte("issued_at", tsStart).lt("issued_at", tsEnd);
  const { data: hTrx } = await supabase
    .from("hatchery_treasury_txns")
    .select("txn_date,direction,category,amount,notes")
    .gte("txn_date", dStart).lt("txn_date", dEnd);

  const hatchery: DeptResult = {
    key: "hatchery", name: DEPT_NAMES.hatchery,
    revenue: 0, expenses: 0, net: 0, expenseRatio: 0, status: "even",
    revenueItems: [], expenseItems: [],
  };

  // Break invoice into per-source rows
  for (const inv of hInv ?? []) {
    const parts: Array<[string, number]> = [
      ["رسوم الكتاكيت", Number(inv.chicks_amount || 0)],
      ["رسوم التحضين", Number(inv.brooding_amount || 0)],
      ["رسوم اللايح (المخصب الناقص)", Number(inv.completed_unhatched_amount || 0)],
      ["رسوم الكشف (المخصب غير المخصب)", Number(inv.infertile_amount || 0)],
    ];
    for (const [label, amt] of parts) {
      if (amt > 0) {
        hatchery.revenue += amt;
        hatchery.revenueItems.push({
          date: inv.issued_at, label, source: label,
          amount: amt, reference: inv.invoice_no, treasury: inv.client_name_snapshot,
        });
      }
    }
  }
  // treasury inflows that aren't already counted as invoices: skip to avoid double-count.
  // Use only outflows as expenses.
  for (const t of hTrx ?? []) {
    if (t.direction === "out") {
      const amt = Number(t.amount || 0);
      hatchery.expenses += amt;
      hatchery.expenseItems.push({
        date: t.txn_date, label: t.category || "مصروف",
        source: t.category || "مصروف", amount: amt, notes: t.notes,
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

  const brooding: DeptResult = {
    key: "brooding", name: DEPT_NAMES.brooding,
    revenue: 0, expenses: 0, net: 0, expenseRatio: 0, status: "even",
    revenueItems: [], expenseItems: [],
  };
  for (const s of bSales ?? []) {
    const amt = Number(s.total_amount || 0);
    brooding.revenue += amt;
    brooding.revenueItems.push({
      date: s.sale_date, label: `مبيعات كتاكيت (${s.count})`,
      source: "مبيعات كتاكيت", amount: amt, treasury: s.customer_name,
    });
  }
  for (const e of bExp ?? []) {
    const amt = Number(e.total_amount || 0);
    brooding.expenses += amt;
    brooding.expenseItems.push({
      date: e.expense_date, label: e.item_name || e.expense_type,
      source: e.expense_type || "مصروف", amount: amt, treasury: e.treasury, notes: e.notes,
    });
  }
  for (const f of bFeed ?? []) {
    const amt = Number(f.total_cost || 0);
    brooding.expenses += amt;
    brooding.expenseItems.push({
      date: f.issue_date, label: `علف: ${f.feed_name} (${f.quantity_kg} كجم)`,
      source: "علف الحضانات", amount: amt, notes: f.notes,
    });
  }

  // ============ Slaughterhouse ============
  const { data: sTrans } = await supabase
    .from("slaughter_branch_transfers")
    .select("transferred_at,cut_name_ar,weight_kg,total_value")
    .gte("transferred_at", tsStart).lt("transferred_at", tsEnd);
  const { data: sExp } = await supabase
    .from("slaughter_custody_expenses")
    .select("expense_date,category,description,amount,beneficiary,status")
    .gte("expense_date", dStart).lt("expense_date", dEnd);
  const { data: sFeed } = await supabase
    .from("slaughterhouse_feed_movements")
    .select("performed_at,movement_type,quantity_kg,total_cost,notes")
    .gte("performed_at", tsStart).lt("performed_at", tsEnd);

  const slaughter: DeptResult = {
    key: "slaughterhouse", name: DEPT_NAMES.slaughterhouse,
    revenue: 0, expenses: 0, net: 0, expenseRatio: 0, status: "even",
    revenueItems: [], expenseItems: [],
  };
  for (const t of sTrans ?? []) {
    const amt = Number(t.total_value || 0);
    slaughter.revenue += amt;
    slaughter.revenueItems.push({
      date: t.transferred_at, label: `${t.cut_name_ar} (${t.weight_kg} كجم)`,
      source: "تحويلات للمخزن/المصنع", amount: amt,
    });
  }
  for (const e of sExp ?? []) {
    if (e.status === "rejected") continue;
    const amt = Number(e.amount || 0);
    slaughter.expenses += amt;
    slaughter.expenseItems.push({
      date: e.expense_date, label: e.description || e.category,
      source: e.category || "عهدة المجزر", amount: amt, treasury: e.beneficiary,
    });
  }
  for (const f of sFeed ?? []) {
    if (f.movement_type !== "in") {
      const amt = Number(f.total_cost || 0);
      if (amt > 0) {
        slaughter.expenses += amt;
        slaughter.expenseItems.push({
          date: f.performed_at, label: `علف المجزر (${f.quantity_kg} كجم)`,
          source: "علف المجزر", amount: amt, notes: f.notes,
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

  const feedF: DeptResult = {
    key: "feed_factory", name: DEPT_NAMES.feed_factory,
    revenue: 0, expenses: 0, net: 0, expenseRatio: 0, status: "even",
    revenueItems: [], expenseItems: [],
  };
  for (const s of fSales ?? []) {
    const amt = Number(s.total_amount || 0);
    feedF.revenue += amt;
    feedF.revenueItems.push({
      date: s.sale_date, label: `مبيعات علف — ${s.customer || ""}`,
      source: s.destination_type === "internal" ? "توريد داخلي" : "مبيعات خارجية",
      amount: amt, reference: s.sale_no,
    });
  }
  for (const p of fInternal ?? []) {
    if (p.status === "rejected") continue;
    const amt = Number(p.amount || 0);
    feedF.revenue += amt;
    feedF.revenueItems.push({
      date: p.payment_date, label: `توريد داخلي — ${p.department_type}`,
      source: "توريدات داخلية", amount: amt, reference: p.payment_no,
    });
  }
  for (const p of fPur ?? []) {
    const amt = Number(p.total_amount || 0) + Number(p.transport_cost || 0) +
      Number(p.tobacco_cost || 0) + Number(p.other_expense || 0);
    feedF.expenses += amt;
    feedF.expenseItems.push({
      date: p.purchase_date, label: `خامات علف — ${p.supplier || ""}`,
      source: "خامات العلف", amount: amt, reference: p.purchase_no,
    });
  }
  for (const t of fTrx ?? []) {
    if (t.direction === "out" && t.kind !== "raw_purchase") {
      const amt = Number(t.amount || 0);
      feedF.expenses += amt;
      feedF.expenseItems.push({
        date: t.txn_date, label: t.kind || "مصروف",
        source: t.kind || "مصروف", amount: amt, treasury: t.party, notes: t.note,
      });
    }
  }

  const depts = [hatchery, brooding, slaughter, feedF];
  for (const d of depts) {
    d.net = d.revenue - d.expenses;
    d.expenseRatio = d.revenue > 0 ? (d.expenses / d.revenue) * 100 : 0;
    d.status = d.net > 0 ? "profit" : d.net < 0 ? "loss" : "even";
    // top sources
    const groupBy = (arr: LineItem[]) => {
      const m = new Map<string, number>();
      for (const i of arr) m.set(i.source, (m.get(i.source) || 0) + i.amount);
      return [...m.entries()].map(([source, amount]) => ({ source, amount }))
        .sort((a, b) => b.amount - a.amount);
    };
    const rev = groupBy(d.revenueItems);
    const exp = groupBy(d.expenseItems);
    d.topRevenueSource = rev[0];
    d.topExpenseItem = exp[0];
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
        acc.revenue += d.revenue; acc.expenses += d.expenses; acc.net += d.net;
        return acc;
      },
      { revenue: 0, expenses: 0, net: 0 },
    );

    // Aggregate top revenue sources & expense items across all depts
    const aggRev = new Map<string, { source: string; dept: string; amount: number }>();
    const aggExp = new Map<string, { source: string; dept: string; amount: number }>();
    for (const d of current) {
      for (const i of d.revenueItems) {
        const k = `${d.key}|${i.source}`;
        const cur = aggRev.get(k) || { source: i.source, dept: d.name, amount: 0 };
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
      .map(r => ({ ...r, pctOfTotal: totals.revenue > 0 ? (r.amount / totals.revenue) * 100 : 0 }));
    const topExpenseItems = [...aggExp.values()]
      .sort((a, b) => b.amount - a.amount).slice(0, 15)
      .map(r => ({ ...r, pctOfTotal: totals.expenses > 0 ? (r.amount / totals.expenses) * 100 : 0 }));

    // Highlights
    const profitable = [...current].sort((a, b) => b.net - a.net);
    const mostProfit = profitable[0];
    const mostLoss = profitable[profitable.length - 1];
    const byRev = [...current].sort((a, b) => b.revenue - a.revenue)[0];
    const byExp = [...current].sort((a, b) => b.expenses - a.expenses)[0];

    // Previous-month comparison
    const comparison = current.map(d => {
      const prev = previous.find(p => p.key === d.key)!;
      return {
        key: d.key, name: d.name,
        currentNet: d.net, previousNet: prev.net,
        currentRevenue: d.revenue, previousRevenue: prev.revenue,
        currentExpenses: d.expenses, previousExpenses: prev.expenses,
        revenueDelta: d.revenue - prev.revenue,
        expensesDelta: d.expenses - prev.expenses,
        netDelta: d.net - prev.net,
        revenuePct: prev.revenue > 0 ? ((d.revenue - prev.revenue) / prev.revenue) * 100 : null,
        expensesPct: prev.expenses > 0 ? ((d.expenses - prev.expenses) / prev.expenses) * 100 : null,
      };
    });

    // Alerts
    const alerts: { level: "warn" | "danger" | "info"; message: string }[] = [];
    for (const d of current) {
      if (d.status === "loss") {
        alerts.push({ level: "danger", message: `${d.name}: خسارة بقيمة ${Math.abs(d.net).toLocaleString()} ج.م` });
      }
      if (d.expenseRatio > 100) {
        alerts.push({ level: "danger", message: `${d.name}: المصروفات أعلى من الإيرادات (${d.expenseRatio.toFixed(0)}%)` });
      } else if (d.expenseRatio > 85 && d.revenue > 0) {
        alerts.push({ level: "warn", message: `${d.name}: نسبة المصروفات مرتفعة (${d.expenseRatio.toFixed(0)}%)` });
      }
    }
    for (const c of comparison) {
      if (c.expensesPct != null && c.expensesPct > 25) {
        alerts.push({ level: "warn", message: `${c.name}: مصروفات الشهر زادت بنسبة ${c.expensesPct.toFixed(0)}% عن الشهر السابق` });
      }
      if (c.revenuePct != null && c.revenuePct < -25) {
        alerts.push({ level: "warn", message: `${c.name}: إيرادات الشهر انخفضت بنسبة ${Math.abs(c.revenuePct).toFixed(0)}% عن الشهر السابق` });
      }
    }
    // High-ratio expense buckets
    for (const d of current) {
      if (d.expenses === 0) continue;
      const buckets = new Map<string, number>();
      for (const i of d.expenseItems) buckets.set(i.source, (buckets.get(i.source) || 0) + i.amount);
      for (const [src, amt] of buckets) {
        const pct = (amt / d.expenses) * 100;
        if (pct >= 60) {
          alerts.push({ level: "info", message: `${d.name}: بند "${src}" يمثل ${pct.toFixed(0)}% من مصروفات القسم` });
        }
      }
    }

    return new Response(
      JSON.stringify({
        year, month,
        departments: current,
        previous,
        totals,
        highlights: {
          mostProfit: mostProfit && { key: mostProfit.key, name: mostProfit.name, net: mostProfit.net },
          mostLoss: mostLoss && { key: mostLoss.key, name: mostLoss.name, net: mostLoss.net },
          topRevenueDept: byRev && { key: byRev.key, name: byRev.name, revenue: byRev.revenue },
          topExpenseDept: byExp && { key: byExp.key, name: byExp.name, expenses: byExp.expenses },
          biggestRevenueSource: topRevenueSources[0],
          biggestExpenseItem: topExpenseItems[0],
        },
        topRevenueSources,
        topExpenseItems,
        comparison,
        alerts,
        unclassified: { count: 0, note: "كل الحركات الحالية مرتبطة بأقسامها مباشرة." },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("dept-budget error", err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
