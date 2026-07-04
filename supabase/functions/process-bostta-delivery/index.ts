// Edge Function: process-bostta-delivery
// Bulk update of Agouza pending orders based on parsed Bostta shipments.
//
// Body: { filename, shipments: [{ phone, cod, shipment_date, bill_no, items: [{product_id, product_name, quantity, unit_price, is_gift?}] }] }
//
// For each shipment:
//   1. Find matching Agouza pending order by phone (oldest created_at ≤ shipment_date +1d).
//   2. Replace order_items with sheet items (only if different).
//   3. Update orders: total = cod, status='delivered', delivered_at=now(), stock_status='dispatched'.
//   4. Reserve+commit Agouza stock via RPCs (deducts inventory).
//   5. Log the diff in stock_router_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

interface ShipmentItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  is_gift?: boolean;
}
interface Shipment {
  phone: string;
  cod: number;
  shipment_date?: string;
  bill_no?: string;
  customer_name?: string;
  raw_products?: string;
  unknown_tokens?: string[];
  items: ShipmentItem[];
}


const AGOUZA_WAREHOUSE_ID = "a970d469-37df-40e1-b99f-a49195a3778e";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // JWT check
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userRes.user.id;

    const body = await req.json();
    const shipments: Shipment[] = Array.isArray(body?.shipments) ? body.shipments : [];
    const filename: string = String(body?.filename || "unknown.xlsx");
    if (shipments.length === 0) {
      return new Response(JSON.stringify({ error: "No shipments" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = {
      updated: [] as any[],
      product_diffs: [] as any[],
      unmatched: [] as any[],
      unregistered_queued: [] as any[],
      already_delivered: [] as any[],
      errors: [] as any[],
    };


    for (const s of shipments) {
      try {
        if (!s.phone) { results.unmatched.push({ shipment: s, reason: "no_phone" }); continue; }

        // find customer by phone OR phone2 (customers may have two numbers)
        const { data: customers } = await supabase
          .from("customers").select("id, name")
          .or(`phone.eq.${s.phone},phone2.eq.${s.phone}`)
          .limit(5);
        if (!customers || customers.length === 0) {
          // Queue as unregistered shipment (moderator needs to create the order)
          if (s.bill_no) {
            await supabase.from("unregistered_bostta_shipments").upsert({
              bill_no: s.bill_no,
              phone: s.phone,
              customer_name: s.customer_name || "غير معروف",
              cod: s.cod,
              shipment_date: s.shipment_date || null,
              raw_products: s.raw_products || null,
              parsed_items: s.items,
              unknown_tokens: s.unknown_tokens || [],
              status: "pending",
              uploaded_from_filename: filename,
              uploaded_by: userId,
            }, { onConflict: "bill_no", ignoreDuplicates: false });
          }
          results.unregistered_queued.push({ shipment: s });
          continue;
        }
        const customerIds = customers.map((c: any) => c.id);


        // find candidate orders
        const shipDate = s.shipment_date ? new Date(s.shipment_date) : new Date();
        const upperBound = new Date(shipDate.getTime() + 24 * 3600 * 1000).toISOString();

        const { data: candidates } = await supabase
          .from("orders")
          .select("id, order_number, status, total, created_at, source_warehouse_id, stock_status")
          .in("customer_id", customerIds)
          .eq("source_warehouse_id", AGOUZA_WAREHOUSE_ID)
          .lte("created_at", upperBound)
          .order("created_at", { ascending: true });

        const pending = (candidates || []).filter((o: any) => o.status === "pending");
        const delivered = (candidates || []).filter((o: any) => o.status === "delivered");

        if (pending.length === 0) {
          if (delivered.length > 0) {
            results.already_delivered.push({ shipment: s, order_number: delivered[delivered.length - 1].order_number });
          } else {
            results.unmatched.push({ shipment: s, reason: "no_pending_agouza_order" });
          }
          continue;
        }

        const order = pending[0]; // oldest pending

        // Fetch existing items for diff logging
        const { data: existingItems } = await supabase
          .from("order_items")
          .select("id, product_id, product_name, quantity, unit_price")
          .eq("order_id", order.id);

        const oldSig = JSON.stringify((existingItems || []).map((i: any) => `${i.product_id}:${i.quantity}`).sort());
        const newSig = JSON.stringify(s.items.map((i) => `${i.product_id}:${i.quantity}`).sort());
        const hasProductDiff = oldSig !== newSig;

        // 1. Delete existing items
        await supabase.from("order_items").delete().eq("order_id", order.id);

        // 2. Insert new items
        const rows = s.items.map((it) => ({
          order_id: order.id,
          product_id: it.product_id,
          product_name: it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total_price: it.quantity * it.unit_price,
        }));
        if (rows.length > 0) {
          const { error: insErr } = await supabase.from("order_items").insert(rows);
          if (insErr) throw new Error(`insert order_items: ${insErr.message}`);
        }

        // 3. Reserve Agouza stock (fresh — releases old if any)
        // Release any existing reservation first (safe if none)
        await supabase.rpc("release_agouza_stock_reservation", {
          p_order_id: order.id, p_reason: "bostta_bulk_upload_replace",
        });
        const { data: reserveRes, error: reserveErr } = await supabase.rpc("reserve_agouza_stock_for_order", {
          p_order_id: order.id,
        });
        if (reserveErr) throw new Error(`reserve: ${reserveErr.message}`);
        // NOTE: shortages are IGNORED here — user requested to allow negative stock
        // in Agouza until the physical inventory is reconciled on the system.
        const shortages = reserveRes && !(reserveRes as any).ok ? (reserveRes as any).shortages : null;


        // 4. Commit — deducts stock + writes inventory_movements
        // If reservation had shortages, commit may fail. We swallow that so the
        // order is still marked delivered; stock will go negative or stay put
        // and be corrected during physical inventory reconciliation.
        const { error: commitErr } = await supabase.rpc("commit_agouza_stock_on_delivery", {
          p_order_id: order.id,
        });
        const commit_skipped = commitErr ? commitErr.message : null;


        // 5. Update order status
        const routerLog = {
          bostta_bulk: {
            uploaded_by: userId,
            uploaded_at: new Date().toISOString(),
            filename,
            bill_no: s.bill_no || null,
            product_diff: hasProductDiff,
            old_items: existingItems || [],
            new_items: s.items,
            cod: s.cod,
            shortages,
            commit_skipped,
          },
        };

        const { error: updErr } = await supabase.from("orders").update({
          status: "delivered",
          delivered_at: new Date().toISOString(),
          total: s.cod,
          stock_status: "dispatched",
          stock_router_log: routerLog,
          updated_at: new Date().toISOString(),
        }).eq("id", order.id);
        if (updErr) throw new Error(`update order: ${updErr.message}`);

        results.updated.push({
          order_number: order.order_number,
          phone: s.phone,
          cod: s.cod,
          product_diff: hasProductDiff,
        });
        if (hasProductDiff) {
          results.product_diffs.push({
            order_number: order.order_number,
            old_items: existingItems || [],
            new_items: s.items,
          });
        }
      } catch (e: any) {
        results.errors.push({ shipment: s, reason: e?.message || String(e) });
      }
    }

    // Save upload audit
    await supabase.from("bostta_delivery_uploads").insert({
      filename,
      uploaded_by: userId,
      shipments_total: shipments.length,
      updated_count: results.updated.length,
      product_diffs_count: results.product_diffs.length,
      unmatched_count: results.unmatched.length + results.unregistered_queued.length,
      warnings_count: results.already_delivered.length + results.errors.length,

      summary: results,
    });

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
