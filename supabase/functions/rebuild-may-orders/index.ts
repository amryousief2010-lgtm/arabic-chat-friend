// Rebuild May 2026 order items from canonical Excel rows.
// Strict rules: products columns are the only source of truth for items.
//
// Auth: only general_manager may run.
// For each row:
//   1. Find matching order in DB (by phone + |timestamp| within ±10 min + moderator).
//   2. Look up product_id for each canonical product name.
//   3. DELETE existing order_items for that order.
//   4. INSERT new order_items from Excel.
//   5. Re-read items and validate match (count, names, quantities).
//   6. Optionally update orders.shipping_company / source / moderator / offer_name.
//   7. Audit-log every action.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface IncomingItem {
  productName: string;
  quantity: number;
  excelRawValue: number;
  isHalfKgApplied: boolean;
  ambiguous: boolean;
  sourceColumn: string;
}

interface IncomingRow {
  excelRow: number;
  timestamp: string; // ISO-ish string
  moderator: string;
  customerName: string;
  customerPhone: string;
  shippingCompany: string;
  source: string;
  offerName: string;
  orderValue: number;
  items: IncomingItem[];
}

interface RebuildOpts {
  dryRun?: boolean;
  matchToleranceMinutes?: number;
  /** If true, also write shipping_company / source / moderator / offer_name. */
  updateMetadata?: boolean;
}

interface RowResult {
  excelRow: number;
  customerName: string;
  customerPhone: string;
  orderId: string | null;
  orderNumber: string | null;
  matched: boolean;
  rebuilt: boolean;
  itemsBefore: number;
  itemsAfter: number;
  validation: { ok: boolean; reason?: string };
  error?: string;
}

const TOLERANCE_MS_DEFAULT = 10 * 60 * 1000;

const normName = (s: string) => (s || "").trim();
const normPhone = (s: string) =>
  (s || "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
    .replace(/[^\d]/g, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ---- Auth ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.slice("Bearer ".length);
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "general_manager")
      .maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const rows: IncomingRow[] = body.rows ?? [];
    const opts: RebuildOpts = body.options ?? {};
    const dryRun = !!opts.dryRun;
    const updateMetadata = opts.updateMetadata !== false;
    const tolerance =
      (opts.matchToleranceMinutes ?? 10) * 60 * 1000;
    const sourceFile: string = body.sourceFile ?? "may-rebuild.xlsx";

    if (!Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "rows array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (rows.length > 2000) {
      return new Response(JSON.stringify({ error: "max 2000 rows per call" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- Pre-load products and candidate May 2026 orders for matching ----
    const { data: products } = await supabase
      .from("products")
      .select("id, name");
    const productByName = new Map<string, { id: string; name: string }>();
    for (const p of products ?? []) {
      productByName.set(normName(p.name), p);
    }

    // Pull all May 2026 orders for the 4 girls, with customer phone
    const { data: candidates } = await supabase
      .from("orders")
      .select(
        "id, order_number, moderator, created_at, total, subtotal, customer_id, customers!inner(phone)"
      )
      .gte("created_at", "2026-05-01T00:00:00Z")
      .lt("created_at", "2026-06-01T00:00:00Z");

    const byPhone = new Map<string, any[]>();
    for (const o of (candidates ?? []) as any[]) {
      const phone = normPhone(o.customers?.phone ?? "");
      if (!phone) continue;
      const arr = byPhone.get(phone) ?? [];
      arr.push(o);
      byPhone.set(phone, arr);
    }

    const usedOrderIds = new Set<string>();
    const results: RowResult[] = [];

    for (const row of rows) {
      const result: RowResult = {
        excelRow: row.excelRow,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        orderId: null,
        orderNumber: null,
        matched: false,
        rebuilt: false,
        itemsBefore: 0,
        itemsAfter: 0,
        validation: { ok: false, reason: "not_processed" },
      };

      try {
        const phone = normPhone(row.customerPhone);
        const ts = new Date(row.timestamp).getTime();
        const list = byPhone.get(phone) ?? [];

        // Pick the closest-in-time candidate not already used,
        // prefer same moderator.
        let best: any = null;
        let bestDelta = Number.POSITIVE_INFINITY;
        for (const o of list) {
          if (usedOrderIds.has(o.id)) continue;
          const d = Math.abs(new Date(o.created_at).getTime() - ts);
          const sameMod = (o.moderator ?? "").trim() === row.moderator.trim();
          const adjusted = sameMod ? d : d + 5 * 60 * 1000; // penalize different moderator slightly
          if (adjusted < bestDelta && d <= tolerance) {
            bestDelta = adjusted;
            best = o;
          }
        }

        if (!best) {
          result.validation = { ok: false, reason: "لم يتم العثور على طلب مطابق في النظام" };
          results.push(result);
          continue;
        }

        usedOrderIds.add(best.id);
        result.orderId = best.id;
        result.orderNumber = best.order_number;
        result.matched = true;

        // Count existing items
        const { count: before } = await supabase
          .from("order_items")
          .select("id", { count: "exact", head: true })
          .eq("order_id", best.id);
        result.itemsBefore = before ?? 0;

        if (row.items.length === 0) {
          result.validation = { ok: false, reason: "الصف لا يحتوي على أعمدة منتجات" };
          results.push(result);
          continue;
        }

        // Build new items with product_id lookups
        const itemsPayload = row.items.map((it) => {
          const p = productByName.get(normName(it.productName));
          const unitPrice = row.orderValue && row.items.length
            ? row.orderValue / row.items.reduce((s, x) => s + x.quantity, 0)
            : 0;
          return {
            order_id: best.id,
            product_id: p?.id ?? null,
            product_name: p?.name ?? it.productName,
            quantity: it.quantity,
            unit_price: unitPrice,
            total_price: unitPrice * it.quantity,
            is_half_kg: it.isHalfKgApplied && it.excelRawValue % 2 === 1,
          };
        });

        if (dryRun) {
          result.rebuilt = false;
          result.validation = { ok: true, reason: "dry-run" };
          result.itemsAfter = itemsPayload.length;
          results.push(result);
          continue;
        }

        // Replace order_items atomically (delete + insert)
        const { error: delErr } = await supabase
          .from("order_items")
          .delete()
          .eq("order_id", best.id);
        if (delErr) throw new Error("delete failed: " + delErr.message);

        const { data: inserted, error: insErr } = await supabase
          .from("order_items")
          .insert(itemsPayload)
          .select("id, product_name, quantity");
        if (insErr) throw new Error("insert failed: " + insErr.message);

        result.itemsAfter = inserted?.length ?? 0;
        result.rebuilt = true;

        // Optional metadata sync
        if (updateMetadata) {
          await supabase
            .from("orders")
            .update({
              shipping_company: row.shippingCompany || null,
              source: row.source || null,
              moderator: row.moderator || null,
            })
            .eq("id", best.id);
        }

        // Validate
        const expectedSorted = [...row.items]
          .map((i) => ({ name: normName(i.productName), q: Number(i.quantity) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const actualSorted = (inserted ?? [])
          .map((i: any) => ({ name: normName(i.product_name), q: Number(i.quantity) }))
          .sort((a: any, b: any) => a.name.localeCompare(b.name));

        let ok = expectedSorted.length === actualSorted.length;
        let reason: string | undefined;
        if (ok) {
          for (let i = 0; i < expectedSorted.length; i++) {
            if (expectedSorted[i].name !== actualSorted[i].name) {
              ok = false;
              reason = `اسم مختلف: ${expectedSorted[i].name} ≠ ${actualSorted[i].name}`;
              break;
            }
            if (Math.abs(expectedSorted[i].q - actualSorted[i].q) > 0.001) {
              ok = false;
              reason = `كمية مختلفة لـ ${expectedSorted[i].name}: ${expectedSorted[i].q} ≠ ${actualSorted[i].q}`;
              break;
            }
          }
        } else {
          reason = `عدد مختلف: ${expectedSorted.length} ≠ ${actualSorted.length}`;
        }
        result.validation = { ok, reason };
      } catch (e) {
        result.error = (e as Error).message;
        result.validation = { ok: false, reason: result.error };
      }

      results.push(result);
    }

    const summary = {
      total: results.length,
      matched: results.filter((r) => r.matched).length,
      rebuilt: results.filter((r) => r.rebuilt).length,
      validated_ok: results.filter((r) => r.validation.ok).length,
      validation_failed: results.filter((r) => !r.validation.ok && r.matched).length,
      unmatched: results.filter((r) => !r.matched).length,
    };

    // Audit log
    try {
      await supabase.from("import_audit_log").insert({
        action: dryRun ? "auto_check" : "correction",
        target_period: "2026-05",
        source_file: sourceFile,
        performed_by: userData.user.id,
        rows_affected: summary.rebuilt,
        details: { summary, dryRun, sample_failed: results.filter((r) => !r.validation.ok).slice(0, 20) },
      });
    } catch (e) {
      console.error("audit log insert failed", (e as Error).message);
    }

    return new Response(JSON.stringify({ success: true, summary, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("rebuild-may-orders error", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
