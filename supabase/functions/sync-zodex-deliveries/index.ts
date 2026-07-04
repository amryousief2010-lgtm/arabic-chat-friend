// Edge Function: sync-zodex-deliveries
// Logs into zodex-eg.com, fetches the shipper balance page, and reconciles
// delivered / returned shipments against local orders. Missing shipments
// (registered in Zodex but not in our DB) are written to zodex_missing_orders
// and Eng. Alaa Hamed is notified.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

// ----- config -----
const ZODEX_BASE = "https://zodex-eg.com/admin-area";
const SHIPPER_ID = 215; // نعام العاصمة
const ITEMS_PER_PAGE = 100;
const DEFAULT_LOOKBACK_DAYS = 14;
const ALAA_USER_ID = "77b71c5f-cfa8-42bc-85de-ae536a3ec1c1"; // م. آلاء حامد
const PHONE_MATCH_AMOUNT_TOLERANCE = 5; // EGP
const DATE_WINDOW_DAYS = 3;
const NAME_MATCH_THRESHOLD = 0.75;

const OP_DELIVERY = "تكلفة التوصيل";
const OP_RETURN = "مرتجعات";
const STATUS_SUCCESS = "تسليم ناجح";
const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";
const AGOUZA_COURIER_NAME = "مندوب العجوزة";

async function getOrCreateAgouzaCustody(admin: any): Promise<string | null> {
  const { data: existing } = await admin
    .from("courier_goods_custodies")
    .select("id")
    .eq("warehouse_id", AGOUZA_WAREHOUSE_ID)
    .eq("courier_name", AGOUZA_COURIER_NAME)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created, error } = await admin
    .from("courier_goods_custodies")
    .insert({
      courier_name: AGOUZA_COURIER_NAME,
      status: "open",
      warehouse_id: AGOUZA_WAREHOUSE_ID,
      notes: "تم فتحها تلقائياً من مزامنة زودكس (فاتورة مقفولة)",
    })
    .select("id")
    .single();
  if (error) { console.error("failed to auto-open Agouza custody", error); return null; }
  return created?.id ?? null;
}

// ----- helpers -----
function normalizePhone(s: string | null | undefined): string {
  if (!s) return "";
  const digits = String(s).replace(/[^\d]/g, "");
  return digits.replace(/^0020|^\+20|^20/, "0").slice(-11);
}

function normalizeArabic(s: string): string {
  return (s || "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u0652]/g, "") // diacritics
    .replace(/[^\u0600-\u06FF\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenSetRatio(a: string, b: string): number {
  const ta = new Set(normalizeArabic(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeArabic(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

function parseZodexDate(s: string): string | null {
  // e.g. "2026-07-04 04:42 PM"
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let hh = parseInt(m[4], 10);
  const mm = parseInt(m[5], 10);
  const ap = (m[6] || "").toUpperCase();
  if (ap === "PM" && hh < 12) hh += 12;
  if (ap === "AM" && hh === 12) hh = 0;
  return `${m[1]}-${m[2]}-${m[3]}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`;
}

// ----- Zodex client -----
class ZodexClient {
  private cookies = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private captureCookies(res: Response) {
    // Deno supports getSetCookie() which returns an array
    const anyH = res.headers as any;
    const list: string[] = typeof anyH.getSetCookie === "function"
      ? anyH.getSetCookie()
      : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of list) {
      const m = line.match(/^\s*([^=;]+)=([^;]*)/);
      if (m) this.cookies.set(m[1].trim(), m[2].trim());
    }
  }

  async login(email: string, password: string) {
    // 1) prime session
    const g = await fetch(`${ZODEX_BASE}/login.php`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      redirect: "manual",
    });
    this.captureCookies(g);
    await g.text();
    // 2) submit login
    const body = new URLSearchParams({
      email, password, location: "", authorize: "1", "remember-me": "1",
    });
    const p = await fetch(`${ZODEX_BASE}/login.php`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": this.cookieHeader(),
      },
      body,
      redirect: "manual",
    });
    this.captureCookies(p);
    await p.text();
    // 3) sanity check
    const idx = await this.get("/index.php");
    if (idx.includes('id="email"') && idx.includes('id="password"')) {
      throw new Error("Zodex login failed - still on login page");
    }
  }

  async get(path: string, params?: Record<string, string | number>): Promise<string> {
    const url = new URL(`${ZODEX_BASE}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Cookie": this.cookieHeader(),
      },
    });
    this.captureCookies(r);
    return await r.text();
  }
}

// ----- HTML parsing -----
interface ZodexRow {
  bill_no: string;
  moderator_name: string;   // extracted from column 6 (name + phone), e.g. "نورا"
  moderator_phone: string;  // extracted from column 6
  customer_phone: string;   // column 8 "رقم المرسل اليه"
  region: string;
  cod_amount: number;
  shipping_fee: number;
  operation_type: string;
  shipment_status: string;
  shipment_date: string;
  raw_date_text: string;
  zodex_receiver: string;   // column 3 "إلي" - the Zodex-side admin (informational)
  invoice_no: string | null; // e.g. "55811" if row is part of a closed payment invoice
}

function splitNameAndPhone(text: string): { name: string; phone: string } {
  const phoneMatch = (text || "").match(/[\d٠-٩]{7,}/);
  const phone = phoneMatch ? normalizePhone(phoneMatch[0]) : "";
  const name = (text || "").replace(/[\d٠-٩+\-()]/g, " ").replace(/\s+/g, " ").trim();
  return { name, phone };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function parseBalanceRows(html: string): ZodexRow[] {
  const rows: ZodexRow[] = [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return rows;
  // Find the largest table (main data table)
  let mainTable: Element | null = null;
  let maxCount = 0;
  for (const t of doc.querySelectorAll("table") as unknown as Element[]) {
    const cnt = (t.textContent || "").match(/ZX\d+/g)?.length || 0;
    if (cnt > maxCount) { maxCount = cnt; mainTable = t; }
  }
  if (!mainTable) return rows;
  for (const tr of mainTable.querySelectorAll("tr") as unknown as Element[]) {
    const tds = tr.querySelectorAll(":scope > td") as unknown as Element[];
    const cells = Array.from(tds).map((td) => (td.textContent || "").replace(/\s+/g, " ").trim());
    // Find waybill cell containing ZX...
    const billIdx = cells.findIndex((c) => /^ZX\d+$/.test(c));
    if (billIdx < 0) continue;
    // Given column layout, waybill is index 5 → offset backwards to derive other columns
    const base = billIdx - 5;
    const get = (i: number) => cells[base + i] ?? "";
    const iso = parseZodexDate(get(14)) || new Date().toISOString();
    const mod = splitNameAndPhone(get(6));
    // Invoice number: appears in one of the trailing cells as "<shipper name>-<invoice_no>"
    // Match on any cell ending with "-<digits>" where digits are 4-7 long.
    let invoiceNo: string | null = null;
    for (let i = cells.length - 1; i >= 0; i--) {
      const mInv = cells[i].match(/-(\d{4,7})\s*$/);
      if (mInv) { invoiceNo = mInv[1]; break; }
    }
    rows.push({
      bill_no: get(5),
      zodex_receiver: get(3),
      moderator_name: mod.name,
      moderator_phone: mod.phone,
      customer_phone: normalizePhone(get(8)),
      region: get(10),
      cod_amount: parseFloat(get(11).replace(/[^\d.-]/g, "")) || 0,
      shipping_fee: parseFloat(get(9).replace(/[^\d.-]/g, "")) || 0,
      operation_type: get(4),
      shipment_status: get(7),
      shipment_date: iso,
      raw_date_text: get(14),
      invoice_no: invoiceNo,
    });
  }
  return rows;
}

// ----- main handler -----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Auth (allow scheduled cron with service key or any authed user)
  const auth = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let triggerSource = "manual";
  let triggeredBy: string | null = null;
  if (auth === `Bearer ${serviceKey}`) {
    triggerSource = "schedule";
  } else if (auth.startsWith("Bearer ")) {
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const token = auth.replace("Bearer ", "");
    const { data } = await anon.auth.getClaims(token);
    if (data?.claims) {
      triggeredBy = data.claims.sub;
    } else {
      // anon key (used by pg_cron) — allow as scheduled trigger
      triggerSource = "schedule";
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const lookbackDays = Math.min(60, Math.max(1, Number(body.lookback_days) || DEFAULT_LOOKBACK_DAYS));
  const maxPages = Math.min(20, Math.max(1, Number(body.max_pages) || 5));

  // Create run row
  const { data: run } = await supabase.from("zodex_sync_runs").insert({
    trigger_source: triggerSource, triggered_by: triggeredBy, status: "running",
  }).select().single();

  const stats = {
    total_rows: 0, delivered_matched: 0, returned_matched: 0,
    missing_created: 0, missing_updated: 0, missing_auto_resolved: 0, unmatched_skipped: 0,
  };
  const errors: string[] = [];

  try {
    const client = new ZodexClient();
    await client.login(Deno.env.get("ZODEX_USERNAME")!, Deno.env.get("ZODEX_PASSWORD")!);

    const fromDate = new Date(Date.now() - lookbackDays * 86400_000).toISOString().slice(0, 10);
    const toDate = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);

    // Fetch pages
    const allRows: ZodexRow[] = [];
    let firstPageDebug: any = null;
    for (let page = 1; page <= maxPages; page++) {
      const html = await client.get("/users.php", {
        action: "showBalance", id: SHIPPER_ID, account_type: "shipper",
        items: ITEMS_PER_PAGE, page, from: fromDate, to: toDate,
      });
      const rows = parseBalanceRows(html);
      if (page === 1) {
        firstPageDebug = {
          html_len: html.length,
          has_login_form: html.includes('id="email"') && html.includes('id="password"'),
          zx_matches: (html.match(/ZX\d+/g) || []).length,
          tr_count: (html.match(/<tr/g) || []).length,
          parsed_rows: rows.length,
          from: fromDate, to: toDate,
        };
      }
      if (!rows.length) break;
      allRows.push(...rows);
      if (rows.length < ITEMS_PER_PAGE) break;
    }
    stats.total_rows = allRows.length;
    (stats as any).debug = firstPageDebug;

    // Process each row
    for (const row of allRows) {
      // Skip anything other than delivery or return operations
      if (row.operation_type !== OP_DELIVERY && row.operation_type !== OP_RETURN) {
        stats.unmatched_skipped++;
        continue;
      }

      // 1) Already-linked order?
      let matchedOrder: any = null;
      {
        const { data } = await supabase.from("orders")
          .select("id, total, delivered_at, status, collection_status, created_at")
          .eq("shipping_bill_no", row.bill_no).maybeSingle();
        if (data) matchedOrder = data;
      }

      // 2) Match by phone + amount + date window
      if (!matchedOrder && row.customer_phone) {
        const winStart = new Date(new Date(row.shipment_date).getTime() - DATE_WINDOW_DAYS * 86400_000).toISOString();
        const winEnd = new Date(new Date(row.shipment_date).getTime() + DATE_WINDOW_DAYS * 86400_000).toISOString();
        const { data: candidates } = await supabase.from("orders")
          .select("id, total, moderator, created_at, customer_id, shipping_bill_no, customers!inner(name, phone)")
          .is("shipping_bill_no", null)
          .gte("created_at", winStart)
          .lte("created_at", winEnd);
        const list = (candidates || []) as any[];
        // pass 1: phone exact + amount close
        for (const c of list) {
          const cp = normalizePhone(c.customers?.phone);
          if (cp === row.customer_phone && Math.abs(Number(c.total || 0) - row.cod_amount) <= PHONE_MATCH_AMOUNT_TOLERANCE) {
            matchedOrder = c;
            break;
          }
        }
        // pass 2: phone match alone (amount off) + moderator name matches
        if (!matchedOrder) {
          for (const c of list) {
            const cp = normalizePhone(c.customers?.phone);
            const modScore = tokenSetRatio(c.moderator || "", row.moderator_name);
            if (cp === row.customer_phone && modScore >= 0.5) { matchedOrder = c; break; }
          }
        }
        // pass 3: moderator name + amount close (phone wrong)
        if (!matchedOrder && row.moderator_name) {
          for (const c of list) {
            const modScore = tokenSetRatio(c.moderator || "", row.moderator_name);
            if (modScore >= NAME_MATCH_THRESHOLD && Math.abs(Number(c.total || 0) - row.cod_amount) <= PHONE_MATCH_AMOUNT_TOLERANCE) {
              matchedOrder = c; break;
            }
          }
        }
      }

      // 3) Update matched order
      if (matchedOrder) {
        const patch: Record<string, any> = {
          shipping_bill_no: row.bill_no,
          zodex_synced_at: new Date().toISOString(),
        };
        if (row.operation_type === OP_DELIVERY) {
          patch.status = "delivered";
          patch.collection_status = "collected";
          patch.total_at_delivery = row.cod_amount;
          if (!matchedOrder.delivered_at) patch.delivered_at = row.shipment_date;
          stats.delivered_matched++;
        } else if (row.operation_type === OP_RETURN) {
          patch.status = "returned";
          patch.zodex_return_amount = row.cod_amount;
          stats.returned_matched++;
        }
        await supabase.from("orders").update(patch).eq("id", matchedOrder.id);

        // Auto-resolve any prior "missing" row for this bill
        const { data: priorMissing } = await supabase.from("zodex_missing_orders")
          .select("id, status").eq("bill_no", row.bill_no).maybeSingle();
        if (priorMissing && priorMissing.status !== "resolved") {
          await supabase.from("zodex_missing_orders").update({
            status: "resolved",
            resolved_order_id: matchedOrder.id,
            resolved_at: new Date().toISOString(),
            ignored_reason: "auto-linked by sync",
          }).eq("id", priorMissing.id);
          stats.missing_auto_resolved++;
        }
        continue;
      }

      // 4) Missing → upsert & notify Alaa (once per new bill)
      const { data: existing } = await supabase.from("zodex_missing_orders")
        .select("id").eq("bill_no", row.bill_no).maybeSingle();
      if (existing) {
        await supabase.from("zodex_missing_orders").update({
          last_seen_at: new Date().toISOString(),
          zodex_status: row.shipment_status,
          cod_amount: row.cod_amount,
        }).eq("id", existing.id);
        stats.missing_updated++;
      } else {
        await supabase.from("zodex_missing_orders").insert({
          bill_no: row.bill_no,
          customer_name: null,
          customer_phone: row.customer_phone,
          region: row.region,
          cod_amount: row.cod_amount,
          moderator_name: row.moderator_name,
          zodex_status: row.shipment_status,
          operation_type: row.operation_type,
          shipment_date: row.shipment_date,
          raw_row: row,
        });
        // Notify Alaa (once per new bill)
        await supabase.from("notifications").insert({
          title: "أوردر مسجل على زودكس وغير موجود عندنا",
          description: `بوليصة ${row.bill_no} • تليفون العميل: ${row.customer_phone || "—"} • الموديرتور: ${row.moderator_name || "—"} • ${row.region || ""} • ${row.cod_amount} ج • ${row.raw_date_text}`,
          type: "zodex_missing",
          target_user_id: ALAA_USER_ID,
        });
        stats.missing_created++;
      }
    }

    // ----- Closed invoices processing -----
    // Group delivery rows by invoice_no; for each new invoice, upsert record,
    // link matched orders, and assign each matched order to Agouza courier custody.
    const invoiceGroups = new Map<string, ZodexRow[]>();
    for (const row of allRows) {
      if (row.operation_type !== OP_DELIVERY) continue;
      if (!row.invoice_no) continue;
      const list = invoiceGroups.get(row.invoice_no) || [];
      list.push(row);
      invoiceGroups.set(row.invoice_no, list);
    }
    const closedInvoiceStats = { invoices_processed: 0, orders_assigned_to_custody: 0, invoices_new: 0 };
    let sharedCustodyId: string | null = null;
    for (const [invoiceNo, invRows] of invoiceGroups.entries()) {
      const totalAmount = invRows.reduce((sum, r) => sum + Number(r.cod_amount || 0), 0);
      // Upsert invoice header
      const { data: existingInv } = await supabase.from("zodex_closed_invoices")
        .select("id, custody_id, processed_at").eq("invoice_no", invoiceNo).eq("shipper_id", SHIPPER_ID).maybeSingle();
      let invoiceId: string;
      let isNew = false;
      if (existingInv) {
        invoiceId = existingInv.id;
        await supabase.from("zodex_closed_invoices").update({
          total_amount: totalAmount,
          orders_count: invRows.length,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", invoiceId);
      } else {
        const { data: created, error: cErr } = await supabase.from("zodex_closed_invoices").insert({
          invoice_no: invoiceNo,
          shipper_id: SHIPPER_ID,
          shipper_name: "نعام العاصمة",
          total_amount: totalAmount,
          orders_count: invRows.length,
        }).select("id").single();
        if (cErr || !created) { errors.push(`invoice_insert ${invoiceNo}: ${cErr?.message}`); continue; }
        invoiceId = created.id;
        isNew = true;
        closedInvoiceStats.invoices_new++;
      }

      // Process each line
      let matchedCount = 0;
      let missingCount = 0;
      let assignedCount = 0;
      for (const r of invRows) {
        // Look up matched order via bill_no (freshly linked in main loop above)
        const { data: ord } = await supabase.from("orders")
          .select("id, order_number").eq("shipping_bill_no", r.bill_no).maybeSingle();
        const matched = !!ord;
        if (matched) matchedCount++; else missingCount++;

        let custodyAssigned = false;
        if (matched && ord) {
          if (!sharedCustodyId) sharedCustodyId = await getOrCreateAgouzaCustody(supabase);
          if (sharedCustodyId) {
            const nowIso = new Date().toISOString();
            const { error: asnErr } = await supabase
              .from("courier_order_assignments")
              .upsert({
                custody_id: sharedCustodyId,
                order_id: ord.id,
                courier_name: AGOUZA_COURIER_NAME,
                warehouse_id: AGOUZA_WAREHOUSE_ID,
                status: "delivered",
                assigned_at: nowIso,
                delivered_at: nowIso,
                notes: `فاتورة زودكس مقفولة ${invoiceNo} — بوليصة ${r.bill_no}`,
              }, { onConflict: "order_id" });
            if (!asnErr) { custodyAssigned = true; assignedCount++; }
            else console.error("custody assign failed", ord.order_number, asnErr);
          }
        }

        // Upsert invoice line
        await supabase.from("zodex_closed_invoice_orders").upsert({
          invoice_id: invoiceId,
          order_id: ord?.id || null,
          bill_no: r.bill_no,
          customer_phone: r.customer_phone,
          moderator_name: r.moderator_name,
          cod_amount: r.cod_amount,
          matched,
          custody_assigned: custodyAssigned,
        }, { onConflict: "invoice_id,bill_no" });
      }

      await supabase.from("zodex_closed_invoices").update({
        orders_matched: matchedCount,
        orders_missing: missingCount,
        custody_id: sharedCustodyId,
        processed_at: existingInv?.processed_at || new Date().toISOString(),
      }).eq("id", invoiceId);

      closedInvoiceStats.invoices_processed++;
      closedInvoiceStats.orders_assigned_to_custody += assignedCount;

      // Notify Alaa about the newly closed invoice
      if (isNew) {
        await supabase.from("notifications").insert({
          title: `فاتورة زودكس مقفولة — ${invoiceNo}`,
          description: `نعام العاصمة • ${invRows.length} أوردر • إجمالى ${totalAmount.toFixed(0)} ج • تم نقلها لعهدة مندوب العجوزة${missingCount ? ` • ⚠️ ${missingCount} أوردر مش مسجل عندنا` : ""}`,
          type: "zodex_invoice_closed",
          target_user_id: ALAA_USER_ID,
        });
      }
    }
    Object.assign(stats, { closed_invoices: closedInvoiceStats });

    // ----- Pipeline counts (Shipper Shipments page) -----
    // Extract `var shipments = [...]` from shippers_shipments page
    let pipelineCounts: Record<string, { count: number; total: number }> | null = null;
    try {
      const html = await client.get("/shippers_shipments.php", {
        action: "shippers_shipments", shipper_id: SHIPPER_ID,
      });
      const m = html.match(/var\s+shipments\s*=\s*(\[[\s\S]*?\]);/);
      if (m) {
        const arr = JSON.parse(m[1]) as Array<{ status?: string; price?: number }>;
        const agg: Record<string, { count: number; total: number }> = {};
        for (const s of arr) {
          const key = (s.status || "غير محدد").trim();
          if (!agg[key]) agg[key] = { count: 0, total: 0 };
          agg[key].count += 1;
          agg[key].total += Number(s.price || 0);
        }
        pipelineCounts = agg;
      }
    } catch (e) {
      errors.push(`pipeline_counts: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ----- Pickup count (Shippings Grouping page) -----
    // The shippings_grouping page lists shippers with pickup shipment counts.
    // Row contains shipper name (نعام العاصمة) plus a numeric count. Extract row and pull number.
    let pickupCount: number | null = null;
    try {
      const html = await client.get("/shippings.php", { action: "shippings_grouping" });
      // Find the row containing نعام العاصمة (or matching shipper_id link)
      // Rows look like: <tr>...<td>نعام العاصمة</td>...<td>N</td>...<a href="...shipper_id=215..."></a></tr>
      const idxShipper = html.indexOf(`shipper_id=${SHIPPER_ID}`);
      const idxName = html.indexOf("نعام العاصمة");
      const anchor = idxShipper >= 0 ? idxShipper : idxName;
      if (anchor >= 0) {
        // Walk back to nearest <tr, forward to </tr>
        const trStart = html.lastIndexOf("<tr", anchor);
        const trEnd = html.indexOf("</tr>", anchor);
        if (trStart >= 0 && trEnd > trStart) {
          const rowHtml = html.slice(trStart, trEnd);
          const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((mm) => mm[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());
          // Find numeric cells; pick the largest plausible count (pickup total)
          const nums = cells
            .map((c) => {
              const nm = c.match(/^\d+$/);
              return nm ? parseInt(nm[0], 10) : null;
            })
            .filter((n): n is number => n !== null);
          if (nums.length) pickupCount = Math.max(...nums);
        }
      }
    } catch (e) {
      errors.push(`pickup_count: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (pipelineCounts && pickupCount !== null) {
      pipelineCounts["بيك أب"] = { count: pickupCount, total: 0 };
    }

    await supabase.from("zodex_sync_runs").update({
      status: "success", finished_at: new Date().toISOString(),
      ...stats, pipeline_counts: pipelineCounts, summary: { errors },
    }).eq("id", run!.id);

    return new Response(JSON.stringify({ ok: true, run_id: run!.id, pipeline_counts: pipelineCounts, ...stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("zodex_sync_runs").update({
      status: "error", finished_at: new Date().toISOString(),
      error_message: msg, ...stats,
    }).eq("id", run!.id);
    return new Response(JSON.stringify({ ok: false, error: msg, ...stats }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
