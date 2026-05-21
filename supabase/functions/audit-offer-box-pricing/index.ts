// Audit & fix offer-box pricing on imported orders.
// Safe by design:
//  - Never touches: order.total, order.subtotal, order.customer, dates,
//    status, shipping, quantities, product_id, gifts beyond price.
//  - Only updates order_items.unit_price and order_items.total_price for
//    orders whose notes contain "العرض: <exact offer box name>".
//  - Matches products by exact (normalized) name. Products that don't map
//    are reported as unmatched and left untouched.
//  - mode=preview returns the diff. mode=apply writes the corrections.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Normalize Arabic product names so "استيك نعام" == "استيك".
const normalizeName = (s: string): string => {
  let x = (s || "").trim();
  x = x.replace(/\s+/g, " ");
  // strip trailing "نعام" qualifier used in imported product_name values
  x = x.replace(/\s*نعام(?:\s+طازج)?\s*$/u, "").trim();
  return x;
};

const parseOfferName = (notes: string | null): string | null => {
  if (!notes) return null;
  const m = notes.match(/^العرض:\s*([^|]+?)(?:\s*\||$)/u);
  if (!m) return null;
  const v = m[1].trim();
  if (!v || v === "null" || v === "منتجات بسعرها الاصلي") return null;
  return v;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const { data: ud } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!ud?.user) return json({ error: "Unauthorized" }, 401);

    const { data: role } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", ud.user.id)
      .in("role", ["general_manager", "executive_manager", "sales_manager", "financial_manager", "accountant"])
      .maybeSingle();
    if (!role) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const mode: "preview" | "apply" = body.mode === "apply" ? "apply" : "preview";
    const onlyOrderIds: string[] | undefined = Array.isArray(body.orderIds) ? body.orderIds : undefined;

    // Load active offer boxes with items + product names
    const { data: boxes } = await supabase
      .from("offer_boxes")
      .select("id, name, offer_price, offer_box_items(product_id, custom_price, quantity, is_gift, products(name))");
    const boxByName = new Map<string, any>();
    for (const b of boxes || []) {
      boxByName.set((b.name || "").trim(), b);
    }
    if (boxByName.size === 0) {
      return json({ mode, totalOrders: 0, affected: [], summary: { byOffer: {} } });
    }

    // Pull imported orders that reference a known offer name. Use a chunked
    // OR filter so we only fetch relevant rows.
    const offerNames = Array.from(boxByName.keys());
    const orFilter = offerNames.map((n) => `notes.ilike.العرض: ${n}%`).join(",");

    let query = supabase
      .from("orders")
      .select("id, order_number, notes, total, customer_id, customers(name, phone), order_items(id, product_id, product_name, quantity, unit_price, total_price)")
      .or(orFilter)
      .order("created_at", { ascending: false })
      .limit(5000);
    if (onlyOrderIds && onlyOrderIds.length) query = query.in("id", onlyOrderIds);

    const { data: orders, error } = await query;
    if (error) return json({ error: error.message }, 500);

    const affected: any[] = [];
    const byOffer: Record<string, { orders: number; itemsCorrected: number; unmatched: number }> = {};

    for (const o of orders || []) {
      const offerName = parseOfferName(o.notes);
      if (!offerName) continue;
      const box = boxByName.get(offerName);
      if (!box) continue;

      // Build expected price map (normalized name -> {price, isGift, productId})
      const expected = new Map<string, { price: number; isGift: boolean; productId: string; rawName: string }>();
      for (const it of box.offer_box_items || []) {
        const pname = it.products?.name || "";
        expected.set(normalizeName(pname), {
          price: Number(it.custom_price),
          isGift: !!it.is_gift,
          productId: it.product_id,
          rawName: pname.trim(),
        });
      }

      const diffs: any[] = [];
      const unmatched: any[] = [];
      for (const oi of o.order_items || []) {
        const key = normalizeName(oi.product_name);
        const exp = expected.get(key);
        if (!exp) {
          unmatched.push({ id: oi.id, product_name: oi.product_name, unit_price: Number(oi.unit_price) });
          continue;
        }
        const expectedUnit = exp.isGift ? 0 : exp.price;
        const expectedTotal = +(expectedUnit * Number(oi.quantity)).toFixed(2);
        const currUnit = Number(oi.unit_price);
        const currTotal = Number(oi.total_price);
        if (Math.abs(currUnit - expectedUnit) > 0.005 || Math.abs(currTotal - expectedTotal) > 0.005 || (oi.product_id && oi.product_id !== exp.productId) || !oi.product_id) {
          diffs.push({
            item_id: oi.id,
            product_name: oi.product_name,
            quantity: Number(oi.quantity),
            current_unit_price: currUnit,
            current_total_price: currTotal,
            expected_unit_price: expectedUnit,
            expected_total_price: expectedTotal,
            is_gift: exp.isGift,
            set_product_id: exp.productId,
          });
        }
      }

      if (diffs.length === 0 && unmatched.length === 0) continue;

      affected.push({
        order_id: o.id,
        order_number: o.order_number,
        offer_name: offerName,
        offer_price: Number(box.offer_price),
        order_total: Number(o.total),
        customer_name: o.customers?.name || "",
        customer_phone: o.customers?.phone || "",
        diffs,
        unmatched,
      });

      byOffer[offerName] = byOffer[offerName] || { orders: 0, itemsCorrected: 0, unmatched: 0 };
      byOffer[offerName].orders += 1;
      byOffer[offerName].itemsCorrected += diffs.length;
      byOffer[offerName].unmatched += unmatched.length;
    }

    let applied = 0;
    if (mode === "apply") {
      for (const a of affected) {
        for (const d of a.diffs) {
          const { error: upErr } = await supabase
            .from("order_items")
            .update({
              unit_price: d.expected_unit_price,
              total_price: d.expected_total_price,
              product_id: d.set_product_id,
            })
            .eq("id", d.item_id);
          if (!upErr) applied += 1;
        }
      }
    }

    return json({
      mode,
      totalOrders: (orders || []).length,
      affected,
      summary: { byOffer, affectedCount: affected.length, applied },
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
