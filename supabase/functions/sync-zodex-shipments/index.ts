// Edge Function: sync-zodex-shipments
// Scrapes Zodex's "كافة الشحنات" (shippings.php) page which lists every waybill
// (including newly-registered pickups that aren't delivered yet), and links the
// bill number (ZX...) to matching local orders by customer phone.
// Complements sync-zodex-deliveries (which only sees closed/delivered rows).

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";



const ZODEX_BASE = "https://zodex-eg.com/admin-area";
const ITEMS_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 5;
const LOOKBACK_DAYS_FOR_ORDER_MATCH = 30;
const AMOUNT_TOLERANCE = 5; // EGP
// Main warehouse system took over on 2026-07-01 (Cairo). Only match orders
// created on/after this date; earlier orders were handled by the old system.
const MAIN_WAREHOUSE_START_DATE = "2026-06-30T22:00:00.000Z"; // 2026-07-01 00:00 Cairo

function normalizePhone(s: string | null | undefined): string {
  if (!s) return "";
  const digits = String(s).replace(/[^\d]/g, "");
  return digits.replace(/^0020|^\+20|^20/, "0").slice(-11);
}

function normalizeBillNo(s: string | null | undefined): string {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

class ZodexClient {
  private cookies = new Map<string, string>();
  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  private captureCookies(res: Response) {
    const list: string[] = (res.headers as any).getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of list) {
      const m = line.match(/^\s*([^=;]+)=([^;]*)/);
      if (m) this.cookies.set(m[1].trim(), m[2].trim());
    }
  }
  async login(email: string, password: string) {
    const g = await fetch(`${ZODEX_BASE}/login.php`, {
      headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual",
    });
    this.captureCookies(g); await g.text();
    const body = new URLSearchParams({
      email, password, location: "", authorize: "1", "remember-me": "1",
    });
    const p = await fetch(`${ZODEX_BASE}/login.php`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.cookieHeader(),
      },
      body, redirect: "manual",
    });
    this.captureCookies(p); await p.text();
    const idx = await this.get("/index.php");
    if (idx.includes('id="email"') && idx.includes('id="password"')) {
      throw new Error("Zodex login failed - still on login page");
    }
  }
  async get(path: string, params?: Record<string, string | number>) {
    const url = new URL(`${ZODEX_BASE}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: this.cookieHeader() },
    });
    this.captureCookies(r);
    return await r.text();
  }
}

interface ShipRow {
  bill_no: string;
  phones: string[];
  cod: number;
  status: string;
  receiver: string;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

function parseShippingRows(html: string, dbg?: any): ShipRow[] {
  const rows: ShipRow[] = [];
  const seen = new Set<string>();

  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) { if (dbg) dbg.reason = "dom_parse_failed"; return rows; }

  if (dbg) {
    dbg.table_count = doc.querySelectorAll("table").length;
    dbg.total_tr = doc.querySelectorAll("tr").length;
    dbg.total_td = doc.querySelectorAll("td").length;
    const firstDataTr: any = Array.from(doc.querySelectorAll("tr")).find((tr: any) =>
      tr.querySelectorAll(":scope > td").length > 10
    );
    if (firstDataTr) {
      const tds = firstDataTr.querySelectorAll(":scope > td");
      dbg.first_data_row_cells = Array.from(tds).map((td: any) =>
        (td.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)
      );
    }
  }

  // Iterate every tr in the document; a row belongs to the shipments table if
  // one of its direct td cells is exactly "ZX...". This avoids ambiguity about
  // nested tables (message-template tooltips live inside the row's own tds).
  const allTrs = doc.querySelectorAll("tr") as unknown as Element[];
  let candidateTrs = 0;
  for (const tr of allTrs) {
    const tds = tr.querySelectorAll(":scope > td") as unknown as Element[];
    if (!tds.length) continue;
    const cells = Array.from(tds).map((td) =>
      (td.textContent || "").replace(/\s+/g, " ").trim()
    );
    // Find bill number. Note the cell often reads "ZX80418582ZX80418582" —
    // the site renders the bill twice (link text + copy button). We want the
    // first ZX\d+ occurrence; \b at the end fails when a Z immediately follows.
    let bill = "";
    for (const c of cells) {
      const bm = c.match(/ZX\d+/);
      if (bm) { bill = normalizeBillNo(bm[0]); break; }
    }
    if (!bill) continue;
    candidateTrs++;
    if (seen.has(bill)) continue;
    seen.add(bill);

    // Collect ONLY the customer phones (columns موبايل 1 / موبايل 2). We do
    // this by requiring the cell to contain nothing except digits / +, spaces
    // and dashes. Cells like "نورا 01008853026" (moderator name + phone) are
    // excluded — otherwise we'd wrongly match orders belonging to a customer
    // whose phone happens to equal a moderator's phone.
    const phoneSet = new Set<string>();
    for (const c of cells) {
      if (!c) continue;
      if (!/^[\d\s+()\-]{10,20}$/.test(c)) continue;
      const compact = c.replace(/[^\d]/g, "");
      if (/^01\d{9}$/.test(compact)) phoneSet.add(compact);
    }

    let cod = 0;
    for (const c of cells) {
      if (/^\d{2,7}(\.\d+)?$/.test(c)) {
        const n = parseFloat(c);
        if (n > cod) cod = n;
      }
    }

    let status = "";
    for (const c of cells) {
      if (c.length > 60) continue;
      if (/طلب بيك أب|بيك اب|جاري التوصيل|تسليم|مرتجع|مؤجل|ملغى|رفض|الغاء/.test(c)) {
        status = c; break;
      }
    }
    let receiver = "";
    for (const c of cells) {
      if (c.length >= 2 && c.length <= 30 && /[\u0600-\u06FF]/.test(c) && !/\d/.test(c)) {
        receiver = c; break;
      }
    }

    rows.push({ bill_no: bill, phones: [...phoneSet], cod, status, receiver });
  }
  if (dbg) dbg.candidate_trs = candidateTrs;
  return rows;
}





Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const auth = req.headers.get("Authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let triggerSource = "manual";
  let triggeredBy: string | null = null;
  if (auth === `Bearer ${serviceKey}`) {
    triggerSource = "schedule";
  } else if (auth.startsWith("Bearer ")) {
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data } = await anon.auth.getClaims(auth.replace("Bearer ", ""));
    if (data?.claims) triggeredBy = data.claims.sub;
    else triggerSource = "schedule";
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const maxPages = Math.min(20, Math.max(1, Number(body.max_pages) || DEFAULT_MAX_PAGES));

  const { data: run } = await supabase.from("zodex_sync_runs").insert({
    trigger_source: triggerSource, triggered_by: triggeredBy, status: "running",
  }).select().single();

  const stats: Record<string, any> = {
    scope: "shippings",
    total_rows: 0,
    linked: 0,
    already_linked: 0,
    no_phone_in_row: 0,
    no_matching_order: 0,
    ambiguous_skipped: 0,
    linked_examples: [] as any[],
    link_failures: [] as any[],
    retries: 0,
  };
  const errors: string[] = [];

  // Retry helper with exponential backoff (max 3 attempts)
  async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        if (attempt >= maxAttempts) break;
        stats.retries++;
        const backoff = attempt === 1 ? 5000 : attempt === 2 ? 15000 : 45000;
        console.warn(`[zodex] retry ${attempt}/${maxAttempts} for ${label}: ${e?.message || e}`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  try {
    const client = new ZodexClient();
    await withRetry("login", () =>
      client.login(
        Deno.env.get("ZODEX_USERNAME")!,
        Deno.env.get("ZODEX_PASSWORD")!,
      )
    );

    const allRows: ShipRow[] = [];
    let pagesFetched = 0;
    for (let page = 1; page <= maxPages; page++) {
      const html = await withRetry(`page ${page}`, () =>
        client.get("/shippings.php", { items: ITEMS_PER_PAGE, page })
      );
      const rows = parseShippingRows(html);
      pagesFetched++;
      if (!rows.length) break;
      allRows.push(...rows);
      if (rows.length < ITEMS_PER_PAGE / 2) break; // last page reached
    }
    stats.total_rows = allRows.length;
    stats.pages_fetched = pagesFetched;



    const claimedThisRun = new Set<string>();
    const lookbackMin = new Date(Date.now() - LOOKBACK_DAYS_FOR_ORDER_MATCH * 86400_000).toISOString();
    // Never match orders older than the main-warehouse cutover date.
    const minCreated = lookbackMin > MAIN_WAREHOUSE_START_DATE ? lookbackMin : MAIN_WAREHOUSE_START_DATE;

    for (const row of allRows) {
      const failure = (reason: string, extra: Record<string, any> = {}) => {
        if (stats.link_failures.length < 50) {
          stats.link_failures.push({ bill_no: row.bill_no, reason, phones: row.phones, cod: row.cod, ...extra });
        }
      };

      // Skip rows without any phone (rare - templated messages hid them)
      if (!row.phones.length) { stats.no_phone_in_row++; failure("no_phone_in_row"); continue; }

      // Is this bill already linked?
      const { data: existing } = await supabase.from("orders")
        .select("id, order_number")
        .eq("shipping_bill_no", row.bill_no)
        .maybeSingle();
      if (existing?.id) { stats.already_linked++; continue; }

      // Find candidate local orders with matching customer phone + no bill yet
      const { data: candidates } = await supabase.from("orders")
        .select("id, order_number, total, created_at, status, customer_id, customers!inner(name, phone)")
        .is("shipping_bill_no", null)
        .gte("created_at", minCreated)
        .in("customers.phone", row.phones);

      let list = ((candidates || []) as any[]).filter((c) => !claimedThisRun.has(c.id));
      if (!list.length) {
        stats.no_matching_order++;
        failure("no_matching_phone", { candidates_total: (candidates || []).length });
        continue;
      }

      // Prefer exact amount match if we captured a COD
      let matchReason = "phone_only";
      if (row.cod > 0) {
        const closeAmount = list.filter((c) => Math.abs(Number(c.total || 0) - row.cod) <= AMOUNT_TOLERANCE);
        if (closeAmount.length) { list = closeAmount; matchReason = "phone_and_cod"; }
        else failure("cod_mismatch", { candidate_totals: list.map((c) => c.total) });
      }

      if (list.length > 1) matchReason += "_fifo";

      // If multiple still, take FIFO (oldest created_at) — matches the pickup-queue order
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const winner = list[0];

      const { error: updErr } = await supabase.from("orders")
        .update({ shipping_bill_no: row.bill_no })
        .eq("id", winner.id)
        .is("shipping_bill_no", null); // guard against races
      if (updErr) {
        errors.push(`link ${row.bill_no}→${winner.order_number}: ${updErr.message}`);
        failure("update_error", { message: updErr.message });
        continue;
      }
      claimedThisRun.add(winner.id);
      stats.linked++;

      // Audit
      try {
        await supabase.from("zodex_bill_link_audit").insert({
          bill_no: row.bill_no,
          order_id: winner.id,
          match_reason: matchReason,
          match_score: matchReason.includes("cod") ? 1 : 0.7,
        });
      } catch (_e) { /* non-fatal */ }

      if (stats.linked_examples.length < 20) {
        stats.linked_examples.push({
          bill_no: row.bill_no,
          order_number: winner.order_number,
          phone: row.phones[0],
          cod: row.cod,
          reason: matchReason,
          candidates_considered: (candidates || []).length,
        });
      }
    }

    await supabase.from("zodex_sync_runs").update({
      status: errors.length ? "completed_with_errors" : "success",
      summary: stats,
      pipeline_counts: { linked: stats.linked, already_linked: stats.already_linked, total_rows: stats.total_rows },
      total_rows: stats.total_rows,
      error_message: errors.length ? errors.join(" | ").slice(0, 2000) : null,
      finished_at: new Date().toISOString(),
    }).eq("id", run!.id);

    return new Response(JSON.stringify({ success: true, stats, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    await supabase.from("zodex_sync_runs").update({
      status: "failed",
      summary: stats,
      error_message: String(e?.message || e).slice(0, 2000),
      finished_at: new Date().toISOString(),
    }).eq("id", run!.id);
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e), stats }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
