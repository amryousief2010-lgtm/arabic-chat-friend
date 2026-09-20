// Edge Function: sync-zodex-shipments
// Scrapes Zodex's "كافة الشحنات" (shippings.php) page which lists every waybill
// (including newly-registered pickups that aren't delivered yet), and links the
// bill number (ZX...) to matching local orders by customer phone.
// Complements sync-zodex-deliveries (which only sees closed/delivered rows).
//
// Automatic path: pg_cron job `sync-zodex-awb-auto` (every 5 minutes, quick)
// POSTs here with the Vault service-role JWT. Weekly full review is a separate
// cron (`sync-zodex-awb-weekly-full`). Manual path: Zodex Review «مزامنة الآن».

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  AGOUZA_WAREHOUSE_ID,
  amountMatchesZodex,
  collectAwbCandidates,
  dedupeByBill,
  indexAwbCandidate,
  isExpectedZodexShipment,
  parseZodexDate,
  pickAwbLinkWinner,
  resolveScheduledMode,
  resolveWindow,
  rowInWindow,
  shouldStopPaging,
  type SyncMode,
  type SyncWindow,
} from "../_shared/zodexSync.ts";
import {
  isAuthResponse,
  isServiceRoleBearer,
  requireVerifiedUser,
  userHasAnyRole,
  ZODEX_SYNC_ALLOWED_ROLES,
} from "../_shared/require-user.ts";

const ZODEX_BASE = "https://zodex-eg.com/admin-area";
const ITEMS_PER_PAGE = 50;
// Hard safety ceiling on pages; the real stop condition is the time window.
const MAX_PAGES_CEILING = 20;
const DEFAULT_MAX_PAGES = 8;
const LOOKBACK_DAYS_FOR_ORDER_MATCH = 14;
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
  /** Column «التاريخ» → bill creation date (ISO). */
  created_at: string | null;
  /** Column «اخر تغيير بالحالة» → last modification (ISO), used as updated_at. */
  updated_at: string | null;
}


function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

// Lightweight regex-based parser. The previous implementation used deno_dom's
// WASM DOMParser which blew the edge function CPU budget on large pages
// (WORKER_RESOURCE_LIMIT). Regex scanning is ~100x cheaper here.
function parseShippingRows(html: string, dbg?: any): ShipRow[] {
  const rows: ShipRow[] = [];
  const seen = new Set<string>();

  const chunks = html.split(/<tr[\s>]/i);
  let candidateTrs = 0;
  for (const chunk of chunks) {
    if (!/ZX\d+/.test(chunk)) continue;
    const cells: string[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let m: RegExpExecArray | null;
    while ((m = tdRe.exec(chunk)) !== null) {
      cells.push(stripTags(m[1]));
      if (cells.length > 40) break;
    }
    if (!cells.length) continue;

    let bill = "";
    for (const c of cells) {
      const bm = c.match(/ZX\d+/);
      if (bm) { bill = normalizeBillNo(bm[0]); break; }
    }
    if (!bill) continue;
    candidateTrs++;
    if (seen.has(bill)) continue;
    seen.add(bill);

    // Only pure-phone cells (موبايل 1 / موبايل 2), never "name + phone" cells.
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

    // Dates: the first date-looking cell is «التاريخ» (creation); the last one
    // is the most recent change («اخر تغيير بالحالة» / «موعد التأجيل»).
    const dates: string[] = [];
    for (const c of cells) {
      const iso = parseZodexDate(c);
      if (iso) dates.push(iso);
    }
    const createdAt = dates.length ? dates[0] : null;
    let updatedAt: string | null = null;
    for (const d of dates) {
      if (!updatedAt || new Date(d).getTime() > new Date(updatedAt).getTime()) updatedAt = d;
    }

    rows.push({
      bill_no: bill,
      phones: [...phoneSet],
      cod,
      status,
      receiver,
      created_at: createdAt,
      updated_at: updatedAt,
    });

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

  // In-app callers use supabase.functions.invoke (user JWT). Scheduled jobs
  // must send the service-role JWT — the public anon key is rejected.
  let triggerSource = "manual";
  let triggeredBy: string | null = null;
  if (isServiceRoleBearer(req)) {
    triggerSource = "schedule";
  } else {
    const verified = await requireVerifiedUser(req, corsHeaders, supabase);
    if (isAuthResponse(verified)) return verified;
    const allowed = await userHasAnyRole(supabase, verified.user.id, ZODEX_SYNC_ALLOWED_ROLES);
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    triggeredBy = verified.user.id;
  }

  // Overlapping scrapes waste Zodex logins and can hit WORKER_RESOURCE_LIMIT.
  if (triggerSource === "schedule") {
    const { data: running } = await supabase.from("zodex_sync_runs")
      .select("id")
      .eq("status", "running")
      .gte("started_at", new Date(Date.now() - 20 * 60_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (running) {
      return new Response(JSON.stringify({ success: true, skipped: true, reason: "already_running" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const requestedMode: SyncMode = body.mode === "full" ? "full" : "quick";
  const fullDays = Number(body.full_days) || undefined;

  // Timestamp of the cycle START — becomes the new "last successful sync" on
  // full success, so rows created while the sync runs are never skipped.
  const cycleStart = new Date().toISOString();

  const { data: syncState } = await supabase
    .from("zodex_sync_state")
    .select("last_successful_zodex_sync_at, last_full_review_at")
    .eq("id", true)
    .maybeSingle();

  const effectiveMode = resolveScheduledMode({
    requestedMode,
    triggerSource,
    lastFullReviewAt: (syncState as any)?.last_full_review_at || null,
    now: cycleStart,
  });
  const maxPages = Math.min(
    MAX_PAGES_CEILING,
    Math.max(1, Number(body.max_pages) || (effectiveMode === "full" ? MAX_PAGES_CEILING : DEFAULT_MAX_PAGES)),
  );

  const win: SyncWindow = resolveWindow({
    mode: effectiveMode,
    lastSuccessAt: (syncState as any)?.last_successful_zodex_sync_at || null,
    cycleStart,
    fullDays,
  });

  const { data: run } = await supabase.from("zodex_sync_runs").insert({
    trigger_source: triggerSource,
    triggered_by: triggeredBy,
    status: "running",
    sync_mode: win.mode,
    window_from: win.from,
    window_to: win.to,
  }).select().single();


  const stats: Record<string, any> = {
    scope: "shippings",
    sync_mode: win.mode,
    first_run: win.first_run,
    window_from: win.from,
    window_to: win.to,
    previous_success_at: (syncState as any)?.last_successful_zodex_sync_at || null,
    pages_fetched: 0,
    pagination_complete: false,
    bills_fetched: 0,
    orders_compared: 0,
    total_rows: 0,
    linked: 0,
    already_linked: 0,
    no_phone_in_row: 0,
    no_matching_order: 0,
    ambiguous_skipped: 0,
    unresolved: 0,
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

    // ---- INCREMENTAL FETCH ----
    // shippings.php ignores its from/to parameters (verified), and lists rows
    // newest-first. So we page through until rows fall before the window start,
    // tolerating 2 "grace" pages of out-of-order rows before stopping.
    const fetched: ShipRow[] = [];
    let pagesFetched = 0;
    let paginationComplete = false;
    let gracePagesLeft = 2;
    for (let page = 1; page <= maxPages; page++) {
      const html = await withRetry(`page ${page}`, () =>
        client.get("/shippings.php", { items: ITEMS_PER_PAGE, page })
      );
      const rows = parseShippingRows(html);
      pagesFetched++;
      if (!rows.length) { paginationComplete = true; break; }
      fetched.push(...rows.filter((r) => rowInWindow(r, win)));
      if (rows.length < ITEMS_PER_PAGE / 2) { paginationComplete = true; break; } // last page
      const s = shouldStopPaging(rows, win, gracePagesLeft);
      gracePagesLeft = s.gracePagesLeft;
      if (s.stop) { paginationComplete = true; break; }
    }
    // Idempotency: one row per waybill, freshest wins (48h overlap re-reads rows).
    const allRows: ShipRow[] = dedupeByBill(fetched);

    stats.total_rows = allRows.length;
    stats.bills_fetched = allRows.length;
    stats.pages_fetched = pagesFetched;
    stats.pagination_complete = paginationComplete;
    stats.returns_marked = 0;
    stats.returns_skipped_already = 0;
    stats.returns_no_order = 0;
    stats.returns_examples = [] as any[];

    const claimedThisRun = new Set<string>();
    // Scope candidate orders to the reviewed period (plus the matching lookback),
    // instead of scanning every order in the system.
    const windowMin = new Date(
      new Date(win.from).getTime() - LOOKBACK_DAYS_FOR_ORDER_MATCH * 86400_000,
    ).toISOString();
    // Never match orders older than the main-warehouse cutover date.
    const minCreated = windowMin > MAIN_WAREHOUSE_START_DATE ? windowMin : MAIN_WAREHOUSE_START_DATE;


    // ---- BATCH LOOKUPS (avoid per-row queries → CPU limit) ----
    const allBillNos = [...new Set(allRows.map((r) => r.bill_no))];

    // 1) Bills already linked → one query (keep order info for returns processing)
    const linkedByBill = new Map<string, { id: string; status: string; source_warehouse_id: string | null; notes: string | null; order_number: string }>();
    for (let i = 0; i < allBillNos.length; i += 500) {
      const slice = allBillNos.slice(i, i + 500);
      const { data } = await supabase.from("orders")
        .select("id, order_number, status, source_warehouse_id, notes, shipping_bill_no")
        .in("shipping_bill_no", slice);
      for (const r of (data || []) as any[]) linkedByBill.set(String(r.shipping_bill_no), r);
    }
    const alreadyLinkedSet = new Set<string>(linkedByBill.keys());


    // 2) Unlinked delivery-side candidates in the window. Index by 01… and last-9
    // so Zodex 01XXXXXXXXX matches customers.phone / phone2 stored as 20… / +20.
    // Pickup (استلام) is never a candidate — it must not steal a ZX via FIFO.
    const candidatesByPhone = new Map<string, any[]>();
    const CAND_PAGE = 1000;
    const CAND_CAP = 5000;
    let candFrom = 0;
    while (candFrom < CAND_CAP) {
      const { data: candPage, error: candErr } = await supabase.from("orders")
        .select("id, order_number, total, created_at, customer_id, fulfillment_type, shipping_company, source_warehouse_id, status, customers!inner(phone, phone2)")
        .is("shipping_bill_no", null)
        .gte("created_at", minCreated)
        .order("created_at", { ascending: true })
        .range(candFrom, candFrom + CAND_PAGE - 1);
      if (candErr) {
        errors.push(`candidates: ${candErr.message}`);
        break;
      }
      const rows = (candPage || []) as any[];
      for (const o of rows) {
        if (!isExpectedZodexShipment({
          status: o.status,
          shipping_company: o.shipping_company,
          source_warehouse_id: o.source_warehouse_id,
          fulfillment_type: o.fulfillment_type,
        })) continue;
        indexAwbCandidate(candidatesByPhone, o, o.customers?.phone, o.customers?.phone2);
      }
      if (rows.length < CAND_PAGE) break;
      candFrom += CAND_PAGE;
    }


    // How many local orders were actually pulled in for comparison this run.
    const comparedIds = new Set<string>();
    for (const o of linkedByBill.values()) comparedIds.add(o.id);
    for (const list of candidatesByPhone.values()) for (const o of list) comparedIds.add(o.id);
    stats.orders_compared = comparedIds.size;


    // 3) Match in memory, then UPDATE only the winners
    const auditInserts: any[] = [];
    // Statuses that indicate a return/rejection on Zodex.
    const RETURN_RE_LINK = /مرتجع|مرفوض|رفض|راجع|إلغاء|الغاء|ملغى/;
    stats.returns_link_skipped = 0;
    for (const row of allRows) {
      const failure = (reason: string, extra: Record<string, any> = {}) => {
        if (stats.link_failures.length < 50) {
          stats.link_failures.push({ bill_no: row.bill_no, reason, phones: row.phones, cod: row.cod, ...extra });
        }
      };

      if (!row.phones.length) { stats.no_phone_in_row++; failure("no_phone_in_row"); continue; }
      if (alreadyLinkedSet.has(row.bill_no)) { stats.already_linked++; continue; }
      // NEVER heuristically claim an order for a return bill. A customer can have
      // several bills on Zodex (one delivered, one returned); guessing by phone/COD
      // would cancel the wrong order. Return bills act only on an existing exact link.
      if (row.status && RETURN_RE_LINK.test(row.status)) {
        stats.returns_link_skipped++;
        failure("return_bill_not_auto_linked", { status: row.status });
        continue;
      }


      const candidates = collectAwbCandidates(row.phones, candidatesByPhone, claimedThisRun);

      if (!candidates.length) {
        stats.no_matching_order++;
        failure("no_matching_phone", { candidates_total: 0 });
        continue;
      }

      if (row.cod > 0) {
        const amountHit = candidates.some((c) => amountMatchesZodex(Number(c.total || 0), row.cod).ok);
        if (!amountHit) failure("cod_mismatch", { candidate_totals: candidates.map((c) => c.total) });
      }
      const picked = pickAwbLinkWinner(candidates, row.cod);
      if (!picked) {
        stats.no_matching_order++;
        failure("no_matching_phone", { candidates_total: candidates.length });
        continue;
      }
      const winner = picked.winner;
      const matchReason = picked.reason;

      const { error: updErr } = await supabase.from("orders")
        .update({ shipping_bill_no: row.bill_no })
        .eq("id", winner.id)
        .is("shipping_bill_no", null);
      if (updErr) {
        errors.push(`link ${row.bill_no}→${winner.order_number}: ${updErr.message}`);
        failure("update_error", { message: updErr.message });
        continue;
      }
      claimedThisRun.add(winner.id);
      stats.linked++;
      auditInserts.push({
        bill_no: row.bill_no,
        order_id: winner.id,
        match_reason: matchReason,
        match_score: matchReason.includes("cod") ? 1 : 0.7,
      });

      if (stats.linked_examples.length < 20) {
        stats.linked_examples.push({
          bill_no: row.bill_no,
          order_number: winner.order_number,
          phone: row.phones[0],
          cod: row.cod,
          reason: matchReason,
          candidates_considered: candidates.length,
        });
      }
    }

    // Batch audit insert
    if (auditInserts.length) {
      try { await supabase.from("zodex_bill_link_audit").insert(auditInserts); } catch (_e) { /* non-fatal */ }
    }

    // ---- RETURNS PROCESSING ----
    // Any Zodex row whose status text indicates a return/rejection → mark linked order as cancelled.
    // Refresh the bill→order map to include bills we just linked in this run.
    const RETURN_RE = /مرتجع|مرفوض|رفض|راجع|إلغاء|الغاء|ملغى/;
    const returnRows = allRows.filter((r) => r.status && RETURN_RE.test(r.status));
    if (returnRows.length) {
      const missingBills = returnRows.map((r) => r.bill_no).filter((b) => !linkedByBill.has(b));
      if (missingBills.length) {
        for (let i = 0; i < missingBills.length; i += 500) {
          const slice = missingBills.slice(i, i + 500);
          const { data } = await supabase.from("orders")
            .select("id, order_number, status, source_warehouse_id, notes, shipping_bill_no")
            .in("shipping_bill_no", slice);
          for (const r of (data || []) as any[]) linkedByBill.set(String(r.shipping_bill_no), r);
        }
      }

      stats.returns_conflict_delivered = 0;
      stats.returns_conflicts = [] as any[];
      for (const row of returnRows) {
        const ord = linkedByBill.get(row.bill_no);
        if (!ord) { stats.returns_no_order++; continue; }
        if (ord.status === "cancelled") { stats.returns_skipped_already++; continue; }
        // Guard: a customer can have more than one bill on Zodex (one delivered,
        // one returned). Never auto-cancel an order that is already confirmed
        // delivered — flag it for manual review instead.
        if (ord.status === "delivered") {
          stats.returns_conflict_delivered++;
          if (stats.returns_conflicts.length < 20) {
            stats.returns_conflicts.push({
              bill_no: row.bill_no, order_number: ord.order_number, zodex_status: row.status,
            });
          }
          continue;
        }
        // Guard: bills linked heuristically in this very run are not trustworthy
        // enough to cancel on.
        if (claimedThisRun.has(ord.id)) { stats.returns_skipped_already++; continue; }


        const stamp = new Date().toLocaleString("ar-EG");
        const reason = `مرتجع من زودكس (${row.status || "مرتجع"})`;
        const prefix = ord.notes ? ord.notes + "\n" : "";
        const newNotes = `${prefix}[مرتجع - ${stamp}] ${reason}`;

        const { error: upErr } = await supabase.from("orders").update({
          status: "cancelled",
          notes: newNotes,
          update_status_marker: "cancelled",
          update_status_updated_at: new Date().toISOString(),
        } as any).eq("id", ord.id).neq("status", "cancelled");
        if (upErr) { errors.push(`return ${row.bill_no}: ${upErr.message}`); continue; }

        // Release Agouza reservation if applicable
        if (ord.source_warehouse_id === AGOUZA_WAREHOUSE_ID) {
          try {
            await supabase.rpc("release_agouza_stock_reservation", {
              p_order_id: ord.id, p_reason: "zodex_return_sync",
            });
          } catch (e: any) {
            console.warn(`release_agouza failed for ${ord.order_number}:`, e?.message || e);
          }
        }

        stats.returns_marked++;
        if (stats.returns_examples.length < 20) {
          stats.returns_examples.push({
            bill_no: row.bill_no, order_number: ord.order_number, zodex_status: row.status,
          });
        }
      }
    }



    // ---- SYNC STATE COMMIT ----
    // Only a fully clean cycle (login OK + every page fetched + comparison
    // finished + no unhandled error) may advance the last-successful timestamp.
    stats.unresolved = stats.no_matching_order + stats.no_phone_in_row + stats.ambiguous_skipped;
    const fullyComplete = errors.length === 0 && paginationComplete;
    stats.complete = fullyComplete;
    if (fullyComplete) {
      const patch: Record<string, any> = {
        id: true,
        last_successful_zodex_sync_at: cycleStart,
        last_sync_mode: win.mode,
      };
      if (win.mode === "full") patch.last_full_review_at = cycleStart;
      const { error: stErr } = await supabase.from("zodex_sync_state").upsert(patch, { onConflict: "id" });
      if (stErr) console.warn("zodex_sync_state upsert failed:", stErr.message);
    }

    await supabase.from("zodex_sync_runs").update({
      status: fullyComplete ? "success" : "completed_with_errors",
      summary: stats,
      pipeline_counts: { linked: stats.linked, already_linked: stats.already_linked, total_rows: stats.total_rows, returns_marked: stats.returns_marked },
      total_rows: stats.total_rows,
      sync_mode: win.mode,
      window_from: win.from,
      window_to: win.to,
      pages_fetched: stats.pages_fetched,
      orders_compared: stats.orders_compared,
      unresolved_count: stats.unresolved,
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
