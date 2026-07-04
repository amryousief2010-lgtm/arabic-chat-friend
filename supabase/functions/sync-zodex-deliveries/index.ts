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
  moderator_ref: string; // Zodex "to" column (recipient name they typed)
  customer_note: string; // Zodex "order number" free text (often contains moderator name)
  customer_phone: string;
  region: string;
  cod_amount: number;
  shipping_fee: number;
  operation_type: string;
  shipment_status: string;
  shipment_date: string; // ISO
  raw_date_text: string;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function parseBalanceRows(html: string): ZodexRow[] {
  const rows: ZodexRow[] = [];
  // Isolate main table by finding <tr> blocks that contain a ZX bill number
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRegex.exec(html)) !== null) {
    const inner = m[1];
    if (!/ZX\d/.test(inner)) continue;
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells: string[] = [];
    let td: RegExpExecArray | null;
    while ((td = tdRegex.exec(inner)) !== null) cells.push(stripTags(td[1]));
    if (cells.length < 15) continue;
    // Column layout (observed):
    // 0 checkbox | 1 admin | 2 من (shipper) | 3 إلي (recipient name) | 4 operation type
    // 5 waybill | 6 order-ref | 7 shipment status | 8 recipient phone | 9 shipping fee
    // 10 region | 11 cod value | 12 confirmation | 13 notes | 14 date | 15 image | 16 report
    const billMatch = cells[5].match(/ZX\d+/);
    if (!billMatch) continue;
    const iso = parseZodexDate(cells[14]) || new Date().toISOString();
    rows.push({
      bill_no: billMatch[0],
      moderator_ref: cells[3],
      customer_note: cells[6],
      customer_phone: normalizePhone(cells[8]),
      region: cells[10],
      cod_amount: parseFloat(cells[11].replace(/[^\d.-]/g, "")) || 0,
      shipping_fee: parseFloat(cells[9].replace(/[^\d.-]/g, "")) || 0,
      operation_type: cells[4],
      shipment_status: cells[7],
      shipment_date: iso,
      raw_date_text: cells[14],
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
    const { data } = await anon.auth.getClaims(auth.replace("Bearer ", ""));
    if (!data?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    triggeredBy = data.claims.sub;
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
    missing_created: 0, missing_updated: 0, unmatched_skipped: 0,
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
        // pass 2: fuzzy customer name + moderator name (if refs contain moderator hints)
        if (!matchedOrder) {
          for (const c of list) {
            const nameScore = tokenSetRatio(c.customers?.name || "", row.moderator_ref);
            const modScore = tokenSetRatio(c.moderator || "", row.customer_note);
            if (nameScore >= NAME_MATCH_THRESHOLD && modScore >= 0.4) {
              matchedOrder = c;
              break;
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
          customer_name: row.moderator_ref,
          customer_phone: row.customer_phone,
          region: row.region,
          cod_amount: row.cod_amount,
          moderator_name: row.customer_note,
          zodex_status: row.shipment_status,
          operation_type: row.operation_type,
          shipment_date: row.shipment_date,
          raw_row: row,
        });
        // Notify Alaa
        await supabase.from("notifications").insert({
          title: "أوردر مسجل على زودكس وغير موجود عندنا",
          description: `بوليصة ${row.bill_no} • ${row.moderator_ref || ""} • ${row.customer_phone || ""} • ${row.region || ""} • ${row.cod_amount} ج • تاريخ: ${row.raw_date_text}`,
          type: "zodex_missing",
          target_user_id: ALAA_USER_ID,
        });
        stats.missing_created++;
      }
    }

    await supabase.from("zodex_sync_runs").update({
      status: "success", finished_at: new Date().toISOString(),
      ...stats, summary: { errors },
    }).eq("id", run!.id);

    return new Response(JSON.stringify({ ok: true, run_id: run!.id, ...stats }), {
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
