// Phase 2: Read-only AI assistant for general/executive manager only.
// - Verifies caller's role server-side.
// - Builds AGGREGATED summaries only (no raw PII rows).
// - Sends compact JSON context + question to Lovable AI Gateway.
// - Enforces daily usage limits.
// - Logs usage to ai_assistant_query_log (question + module + range only).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PER_USER_DAILY = 25;
const GLOBAL_DAILY = 50;
const ALLOWED_ROLES = ["general_manager", "executive_manager"];
const ALLOWED_MODULES = ["farm", "hatchery", "sales", "orders", "customers", "private_courier", "all"];

const SYSTEM_PROMPT = `أنت مساعد تحليلي عربي داخلي لنظام ERP الخاص بشركة "نعم العاصمة" (Capital Ostrich).
دورك: قراءة الملخصات المُجمَّعة فقط وتقديم تحليل وإجابة موجزة باللغة العربية.

قواعد إلزامية:
- وضع القراءة فقط. ممنوع منعًا باتًا اقتراح أو إصدار أي أمر تعديل/إضافة/حذف للبيانات.
- ممنوع تعديل المخزون، حالات الطلب، حالات الدفع، بيانات العملاء.
- ممنوع تخمين أرقام غير موجودة في الملخص؛ إذا كانت البيانات غير كافية قُل صراحة: "البيانات غير متاحة لهذا السؤال".
- اعتمد فقط على JSON Summary المُرفق. لا تخترع أرقامًا أو أسماء عملاء.
- لا تكشف أي بيانات حساسة (أرقام تليفون كاملة، عناوين، تفاصيل شخصية). إذا طُلبت قُل: "هذا السؤال يحتاج بيانات حساسة، يرجى استخدام التقرير المختص بصلاحياتك."
- استخدم تنسيق Markdown مختصر: عناوين، نقاط، جداول صغيرة عند الحاجة.
- اختم الإجابة بسطر "ملاحظة: هذه قراءة تحليلية فقط، لا تمثل أمرًا تنفيذيًا."`;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

// ---------- Aggregated summary builders (NO raw PII) ----------

async function buildFarmSummary(admin: any, from: Date, to: Date) {
  const { data: prod } = await admin
    .from("farm_egg_production")
    .select("production_date, egg_count, family_id")
    .gte("production_date", isoDate(from))
    .lte("production_date", isoDate(to));
  const total = (prod || []).reduce((s: number, r: any) => s + n(r.egg_count), 0);
  const byDay = new Map<string, number>();
  const byFam = new Map<string, number>();
  (prod || []).forEach((r: any) => {
    byDay.set(r.production_date, (byDay.get(r.production_date) || 0) + n(r.egg_count));
    if (r.family_id) byFam.set(r.family_id, (byFam.get(r.family_id) || 0) + n(r.egg_count));
  });
  const { data: ship } = await admin
    .from("farm_to_hatchery_shipments")
    .select("egg_count, received_egg_count, status")
    .gte("production_date", isoDate(from))
    .lte("production_date", isoDate(to));
  const shipped = (ship || []).reduce((s: number, r: any) => s + n(r.egg_count), 0);
  const received = (ship || []).reduce((s: number, r: any) => s + n(r.received_egg_count), 0);
  return {
    total_eggs: total,
    days_recorded: byDay.size,
    families_recorded: byFam.size,
    daily_avg: byDay.size ? Math.round(total / byDay.size) : 0,
    shipped_to_hatchery: shipped,
    received_at_hatchery: received,
    by_day_sample: Array.from(byDay.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 14)
      .map(([d, c]) => ({ date: d, eggs: c })),
  };
}

async function buildHatcherySummary(admin: any, from: Date, to: Date) {
  const { data: batches } = await admin
    .from("hatch_batches")
    .select("batch_number, receive_date, exit_date, received_eggs, net_eggs, hatched_chicks, machine")
    .gte("receive_date", isoDate(from))
    .lte("receive_date", isoDate(to))
    .limit(500);
  const open = (batches || []).filter((b: any) => !b.exit_date).length;
  const closed = (batches || []).filter((b: any) => b.exit_date).length;
  const totalReceived = (batches || []).reduce((s: number, r: any) => s + n(r.received_eggs), 0);
  const totalNet = (batches || []).reduce((s: number, r: any) => s + n(r.net_eggs), 0);
  const totalChicks = (batches || []).reduce((s: number, r: any) => s + n(r.hatched_chicks), 0);
  const closedBatches = (batches || []).filter((b: any) => b.exit_date && n(b.net_eggs) > 0);
  const avgHatchRate = closedBatches.length
    ? Number(
        (
          (closedBatches.reduce((s: number, r: any) => s + n(r.hatched_chicks) / n(r.net_eggs), 0) /
            closedBatches.length) *
          100
        ).toFixed(1),
      )
    : null;
  const { data: debts } = await admin
    .from("v_hatchery_client_balances")
    .select("client_name, remaining_amount")
    .gt("remaining_amount", 0)
    .order("remaining_amount", { ascending: false })
    .limit(10);
  const totalDebt = (debts || []).reduce((s: number, r: any) => s + n(r.remaining_amount), 0);
  return {
    batches_in_range: batches?.length || 0,
    open_batches: open,
    closed_batches: closed,
    total_received_eggs: totalReceived,
    total_net_eggs: totalNet,
    total_hatched_chicks: totalChicks,
    avg_hatch_rate_pct: avgHatchRate,
    total_outstanding_debt: Number(totalDebt.toFixed(2)),
    top_debtor_clients: (debts || []).map((d: any) => ({
      client: d.client_name,
      remaining: Number(n(d.remaining_amount).toFixed(2)),
    })),
  };
}

async function buildSalesSummary(admin: any, from: Date, to: Date) {
  const { data: orders } = await admin
    .from("orders")
    .select("id, total, status, moderator, shipping_company, fulfillment_type, customer_id, created_at")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .limit(5000);
  const valid = (orders || []).filter((o: any) => o.status !== "cancelled");
  const totalSales = valid.reduce((s: number, r: any) => s + n(r.total), 0);
  const byStatus = new Map<string, number>();
  const byMod = new Map<string, { count: number; total: number }>();
  const byShip = new Map<string, { count: number; total: number }>();
  (orders || []).forEach((o: any) => {
    byStatus.set(o.status, (byStatus.get(o.status) || 0) + 1);
  });
  valid.forEach((o: any) => {
    const m = o.moderator || "غير محدد";
    const mc = byMod.get(m) || { count: 0, total: 0 };
    mc.count++;
    mc.total += n(o.total);
    byMod.set(m, mc);
    const s = o.shipping_company || o.fulfillment_type || "غير محدد";
    const sc = byShip.get(s) || { count: 0, total: 0 };
    sc.count++;
    sc.total += n(o.total);
    byShip.set(s, sc);
  });

  // Top products and governorates via aggregated joins
  const ids = valid.map((o: any) => o.id);
  let topProducts: any[] = [];
  let topGovs: any[] = [];
  if (ids.length) {
    const slice = ids.slice(0, 2000);
    const { data: items } = await admin
      .from("order_items")
      .select("product_name, quantity, total_price")
      .in("order_id", slice);
    const pAgg = new Map<string, { qty: number; total: number }>();
    (items || []).forEach((it: any) => {
      const cur = pAgg.get(it.product_name) || { qty: 0, total: 0 };
      cur.qty += n(it.quantity);
      cur.total += n(it.total_price);
      pAgg.set(it.product_name, cur);
    });
    topProducts = Array.from(pAgg.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, v]) => ({ product: name, qty: Number(v.qty.toFixed(2)), total: Number(v.total.toFixed(2)) }));

    const custIds = Array.from(new Set(valid.map((o: any) => o.customer_id).filter(Boolean))).slice(0, 2000);
    if (custIds.length) {
      const { data: custs } = await admin
        .from("customers")
        .select("id, governorate")
        .in("id", custIds);
      const govMap = new Map<string, string>(
        (custs || []).map((c: any) => [c.id, c.governorate || "غير محدد"]),
      );
      const gAgg = new Map<string, { count: number; total: number }>();
      valid.forEach((o: any) => {
        const g = govMap.get(o.customer_id) || "غير محدد";
        const cur = gAgg.get(g) || { count: 0, total: 0 };
        cur.count++;
        cur.total += n(o.total);
        gAgg.set(g, cur);
      });
      topGovs = Array.from(gAgg.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10)
        .map(([g, v]) => ({ governorate: g, count: v.count, total: Number(v.total.toFixed(2)) }));
    }
  }

  // Delayed orders
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 3);
  const delayed = (orders || []).filter(
    (o: any) =>
      ["pending", "processing"].includes(o.status) && new Date(o.created_at) < cutoff,
  ).length;

  return {
    orders_count: orders?.length || 0,
    valid_orders: valid.length,
    cancelled_orders: (orders || []).length - valid.length,
    total_sales: Number(totalSales.toFixed(2)),
    avg_order_value: valid.length ? Number((totalSales / valid.length).toFixed(2)) : 0,
    by_status: Object.fromEntries(byStatus),
    top_moderators: Array.from(byMod.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([m, v]) => ({ moderator: m, orders: v.count, total: Number(v.total.toFixed(2)) })),
    top_shipping: Array.from(byShip.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([s, v]) => ({ method: s, orders: v.count, total: Number(v.total.toFixed(2)) })),
    top_products: topProducts,
    top_governorates: topGovs,
    delayed_orders_over_3d: delayed,
  };
}

async function buildPrivateCourierSummary(admin: any, from: Date, to: Date) {
  const { data: orders } = await admin
    .from("orders")
    .select("status, total, created_at")
    .eq("fulfillment_type", "private_courier")
    .gte("created_at", from.toISOString())
    .lte("created_at", to.toISOString())
    .limit(2000);
  const byStatus = new Map<string, { count: number; total: number }>();
  (orders || []).forEach((o: any) => {
    const cur = byStatus.get(o.status) || { count: 0, total: 0 };
    cur.count++;
    cur.total += n(o.total);
    byStatus.set(o.status, cur);
  });
  const { data: col } = await admin
    .from("pc_collections")
    .select("status, amount_due, amount_collected");
  const colByStatus = new Map<string, { count: number; due: number; collected: number }>();
  (col || []).forEach((c: any) => {
    const cur = colByStatus.get(c.status) || { count: 0, due: 0, collected: 0 };
    cur.count++;
    cur.due += n(c.amount_due);
    cur.collected += n(c.amount_collected);
    colByStatus.set(c.status, cur);
  });
  return {
    orders_in_range: orders?.length || 0,
    by_status: Object.fromEntries(
      Array.from(byStatus.entries()).map(([k, v]) => [
        k,
        { count: v.count, total: Number(v.total.toFixed(2)) },
      ]),
    ),
    collections_by_status: Object.fromEntries(
      Array.from(colByStatus.entries()).map(([k, v]) => [
        k,
        {
          count: v.count,
          due: Number(v.due.toFixed(2)),
          collected: Number(v.collected.toFixed(2)),
          remaining: Number((v.due - v.collected).toFixed(2)),
        },
      ]),
    ),
  };
}

async function buildCustomersSummary(admin: any) {
  // Aggregates only, NO phones/addresses/emails
  const { count: total } = await admin.from("customers").select("id", { count: "exact", head: true });
  const { data: top } = await admin
    .from("customers")
    .select("name, governorate, total_orders, total_spent")
    .order("total_spent", { ascending: false })
    .limit(10);
  return {
    total_customers: total || 0,
    top_customers: (top || []).map((c: any) => ({
      name: c.name,
      governorate: c.governorate || "غير محدد",
      orders: n(c.total_orders),
      spent: Number(n(c.total_spent).toFixed(2)),
    })),
  };
}

async function buildOrdersSummary(admin: any, from: Date, to: Date) {
  // Subset of sales summary focused on ops
  const summary = await buildSalesSummary(admin, from, to);
  return {
    orders_count: summary.orders_count,
    by_status: summary.by_status,
    delayed_orders_over_3d: summary.delayed_orders_over_3d,
    top_shipping: summary.top_shipping,
  };
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return json({ error: "LOVABLE_API_KEY غير مُعد على الخادم." }, 500);

    // 1) Verify caller using the USER's JWT — service_role is NOT used for data reads.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");

    // User-scoped client — every operational/financial read below runs under the
    // caller's RLS context (orders, customers, products, inventory, hatchery, farm,
    // sales, private_courier, etc.).
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // service_role client is used ONLY for the cross-user global audit count
    // (so one user cannot read another user's log rows). It NEVER touches
    // operational/financial tables.
    const auditAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // 2) Role gate — managers only (read via user's RLS)
    const { data: rolesRows } = await userClient.from("user_roles").select("role").eq("user_id", user.id);
    const userRoles = (rolesRows || []).map((r: any) => r.role);
    if (!userRoles.some((r: string) => ALLOWED_ROLES.includes(r))) {
      return json({ error: "السؤال الحر متاح فقط للمدير العام والمدير التنفيذي." }, 403);
    }

    // 3) Parse + validate input
    const body = await req.json().catch(() => ({}));
    const question = String(body?.question || "").trim();
    const module = String(body?.module || "all");
    const dateFromStr = String(body?.date_from || "");
    const dateToStr = String(body?.date_to || "");
    if (!question || question.length < 3) return json({ error: "السؤال قصير جدًا." }, 400);
    if (question.length > 500) return json({ error: "السؤال طويل جدًا (الحد 500 حرف)." }, 400);
    if (!ALLOWED_MODULES.includes(module)) return json({ error: "موديول غير مدعوم." }, 400);

    const now = new Date();
    const toDate = dateToStr ? new Date(dateToStr) : now;
    let fromDate = dateFromStr ? new Date(dateFromStr) : new Date(now.getTime() - 30 * 86400000);
    const maxRangeDays = 90;
    if ((toDate.getTime() - fromDate.getTime()) / 86400000 > maxRangeDays) {
      fromDate = new Date(toDate.getTime() - maxRangeDays * 86400000);
    }

    // 4) Usage limits — per-user via user RLS; global cross-user count via auditAdmin (counts only).
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const { count: userTodayCount } = await userClient
      .from("ai_assistant_query_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", todayStart.toISOString())
      .like("module", "ai:%");
    if ((userTodayCount || 0) >= PER_USER_DAILY) {
      return json(
        {
          error: `تم الوصول إلى الحد اليومي لاستخدام المساعد الذكي (${PER_USER_DAILY} سؤال/يوم).`,
          remaining: 0,
        },
        429,
      );
    }
    const { count: globalTodayCount } = await auditAdmin
      .from("ai_assistant_query_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString())
      .like("module", "ai:%");
    if ((globalTodayCount || 0) >= GLOBAL_DAILY) {
      return json(
        { error: `تم الوصول إلى الحد اليومي العام للمساعد الذكي (${GLOBAL_DAILY}/يوم).`, remaining: 0 },
        429,
      );
    }

    // 5) Build aggregated context — ALL operational reads use userClient (RLS enforced).
    const ctx: Record<string, unknown> = {
      range: { from: isoDate(fromDate), to: isoDate(toDate) },
      asked_at: now.toISOString(),
    };
    const modules = module === "all" ? ["farm", "hatchery", "sales", "private_courier", "customers"] : [module];
    for (const m of modules) {
      try {
        if (m === "farm") ctx.farm = await buildFarmSummary(userClient, fromDate, toDate);
        else if (m === "hatchery") ctx.hatchery = await buildHatcherySummary(userClient, fromDate, toDate);
        else if (m === "sales") ctx.sales = await buildSalesSummary(userClient, fromDate, toDate);
        else if (m === "orders") ctx.orders = await buildOrdersSummary(userClient, fromDate, toDate);
        else if (m === "private_courier")
          ctx.private_courier = await buildPrivateCourierSummary(userClient, fromDate, toDate);
        else if (m === "customers") ctx.customers = await buildCustomersSummary(userClient);
      } catch (e) {
        ctx[m] = { error: "تعذّر تحضير الملخص" };
      }
    }

    // 6) Call Lovable AI Gateway
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "raw",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `السؤال: ${question}\n\nملخص البيانات المُجمَّعة (JSON — استخدمها وحدها):\n\`\`\`json\n${JSON.stringify(
              ctx,
            )}\n\`\`\``,
          },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      const status = aiResp.status;
      // Log failure (no answer content)
      await userClient.from("ai_assistant_query_log").insert({
        user_id: user.id,
        question,
        module: `ai:${module}:failed`,
        date_from: isoDate(fromDate),
        date_to: isoDate(toDate),
      });
      if (status === 429) return json({ error: "تجاوز معدل الاستخدام (429)، حاول لاحقًا." }, 429);
      if (status === 402)
        return json({ error: "نفذت أرصدة الذكاء الاصطناعي. يرجى إضافة رصيد من إعدادات الحساب." }, 402);
      return json({ error: `خطأ بوابة AI: ${status}`, detail: errText.slice(0, 300) }, 502);
    }

    const aiData = await aiResp.json();
    const answer: string = aiData?.choices?.[0]?.message?.content || "لم يصل رد من النموذج.";

    // 7) Log success (NO answer content stored)
    await admin.from("ai_assistant_query_log").insert({
      user_id: user.id,
      question,
      module: `ai:${module}`,
      date_from: isoDate(fromDate),
      date_to: isoDate(toDate),
    });

    return json({
      answer,
      module,
      range: ctx.range,
      usage: {
        per_user_daily: PER_USER_DAILY,
        used_today: (userTodayCount || 0) + 1,
        remaining: PER_USER_DAILY - ((userTodayCount || 0) + 1),
      },
    });
  } catch (e) {
    return json({ error: "خطأ غير متوقع", detail: String((e as Error)?.message || e) }, 500);
  }
});
