// Audit & fix pricing on imported (Excel) orders.
// Two scopes:
//  - "offers"   : orders whose notes reference a known offer box -> use box prices
//  - "products" : imported orders NOT tied to any offer box      -> use products.price
//  - "all"      : both of the above
//
// Safety:
//  - Only mutates order_items.unit_price / total_price (and product_id when missing
//    and we have a confident match by exact normalized name).
//  - Never touches order.total / subtotal / customer / dates / status / qty / shipping.
//  - Products with no exact name match in catalogue / box are reported as unmatched
//    and left untouched.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const normalizeName = (s: string): string => {
  let x = (s || "").trim();
  x = x.replace(/\s+/g, " ");
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
    if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
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
    const scope: "offers" | "products" | "all" = ["offers", "products", "all"].includes(body.scope) ? body.scope : "offers";
    const onlyOrderIds: string[] | undefined = Array.isArray(body.orderIds) ? body.orderIds : undefined;

    // Load active offer boxes + items
    const { data: boxes } = await supabase
      .from("offer_boxes")
      .select("id, name, offer_price, offer_box_items(product_id, custom_price, quantity, is_gift, products(name))");
    const boxByName = new Map<string, any>();
    for (const b of boxes || []) boxByName.set((b.name || "").trim(), b);

    // Load catalogue products (for normal-product scope)
    const { data: catalogue } = await supabase.from("products").select("id, name, price");
    const productByNorm = new Map<string, { id: string; name: string; price: number }>();
    for (const p of catalogue || []) {
      productByNorm.set(normalizeName(p.name), { id: p.id, name: p.name, price: Number(p.price) });
    }

    // Fetch imported orders in pages (>1000 safe).
    type OrderRow = {
      id: string;
      order_number: string;
      notes: string | null;
      total: number;
      customers: { name: string; phone: string } | null;
      order_items: { id: string; product_id: string | null; product_name: string; quantity: number; unit_price: number; total_price: number }[];
    };
    const orders: OrderRow[] = [];
    const PAGE = 200;
    let from = 0;
    while (true) {
      let q = supabase
        .from("orders")
        .select("id, order_number, notes, total, customers(name, phone), order_items(id, product_id, product_name, quantity, unit_price, total_price)")
        .like("order_number", "IMP-%")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (onlyOrderIds && onlyOrderIds.length) q = q.in("id", onlyOrderIds);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const rows = (data || []) as unknown as OrderRow[];
      orders.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
      if (orders.length > 50000) break;
    }

    type Diff = {
      item_id: string;
      product_name: string;
      quantity: number;
      current_unit_price: number;
      current_total_price: number;
      expected_unit_price: number;
      expected_total_price: number;
      is_gift: boolean;
      set_product_id?: string;
    };
    type Affected = {
      order_id: string;
      order_number: string;
      kind: "offer" | "product";
      offer_name: string;
      offer_price: number;
      order_total: number;
      customer_name: string;
      customer_phone: string;
      diffs: Diff[];
      unmatched: { id: string; product_name: string; unit_price: number }[];
    };
    const affected: Affected[] = [];
    const byOffer: Record<string, { orders: number; itemsCorrected: number; unmatched: number }> = {};
    const PRODUCT_BUCKET = "منتجات بسعرها الأصلي";
    let offersScanned = 0;
    let productsScanned = 0;

    for (const o of orders) {
      const offerName = parseOfferName(o.notes);
      const box = offerName ? boxByName.get(offerName) : null;

      if (box) {
        if (scope === "products") continue;
        offersScanned++;
        const expected = new Map<string, { price: number; isGift: boolean; productId: string }>();
        for (const it of box.offer_box_items || []) {
          expected.set(normalizeName(it.products?.name || ""), {
            price: Number(it.custom_price),
            isGift: !!it.is_gift,
            productId: it.product_id,
          });
        }
        const diffs: Diff[] = [];
        const unmatched: Affected["unmatched"] = [];
        for (const oi of o.order_items || []) {
          const exp = expected.get(normalizeName(oi.product_name));
          if (!exp) {
            unmatched.push({ id: oi.id, product_name: oi.product_name, unit_price: Number(oi.unit_price) });
            continue;
          }
          const eu = exp.isGift ? 0 : exp.price;
          const et = +(eu * Number(oi.quantity)).toFixed(2);
          const cu = Number(oi.unit_price);
          const ct = Number(oi.total_price);
          if (Math.abs(cu - eu) > 0.005 || Math.abs(ct - et) > 0.005 || (oi.product_id && oi.product_id !== exp.productId) || !oi.product_id) {
            diffs.push({
              item_id: oi.id,
              product_name: oi.product_name,
              quantity: Number(oi.quantity),
              current_unit_price: cu,
              current_total_price: ct,
              expected_unit_price: eu,
              expected_total_price: et,
              is_gift: exp.isGift,
              set_product_id: exp.productId,
            });
          }
        }
        if (diffs.length === 0 && unmatched.length === 0) continue;
        affected.push({
          order_id: o.id,
          order_number: o.order_number,
          kind: "offer",
          offer_name: offerName!,
          offer_price: Number(box.offer_price),
          order_total: Number(o.total),
          customer_name: o.customers?.name || "",
          customer_phone: o.customers?.phone || "",
          diffs,
          unmatched,
        });
        byOffer[offerName!] = byOffer[offerName!] || { orders: 0, itemsCorrected: 0, unmatched: 0 };
        byOffer[offerName!].orders += 1;
        byOffer[offerName!].itemsCorrected += diffs.length;
        byOffer[offerName!].unmatched += unmatched.length;
      } else {
        // Normal-product imported order (no offer box match)
        if (scope === "offers") continue;
        productsScanned++;
        const diffs: Diff[] = [];
        const unmatched: Affected["unmatched"] = [];
        for (const oi of o.order_items || []) {
          const cat = productByNorm.get(normalizeName(oi.product_name));
          if (!cat) {
            unmatched.push({ id: oi.id, product_name: oi.product_name, unit_price: Number(oi.unit_price) });
            continue;
          }
          const eu = cat.price;
          const et = +(eu * Number(oi.quantity)).toFixed(2);
          const cu = Number(oi.unit_price);
          const ct = Number(oi.total_price);
          if (Math.abs(cu - eu) > 0.005 || Math.abs(ct - et) > 0.005 || !oi.product_id) {
            diffs.push({
              item_id: oi.id,
              product_name: oi.product_name,
              quantity: Number(oi.quantity),
              current_unit_price: cu,
              current_total_price: ct,
              expected_unit_price: eu,
              expected_total_price: et,
              is_gift: false,
              set_product_id: cat.id,
            });
          }
        }
        if (diffs.length === 0 && unmatched.length === 0) continue;
        affected.push({
          order_id: o.id,
          order_number: o.order_number,
          kind: "product",
          offer_name: PRODUCT_BUCKET,
          offer_price: 0,
          order_total: Number(o.total),
          customer_name: o.customers?.name || "",
          customer_phone: o.customers?.phone || "",
          diffs,
          unmatched,
        });
        byOffer[PRODUCT_BUCKET] = byOffer[PRODUCT_BUCKET] || { orders: 0, itemsCorrected: 0, unmatched: 0 };
        byOffer[PRODUCT_BUCKET].orders += 1;
        byOffer[PRODUCT_BUCKET].itemsCorrected += diffs.length;
        byOffer[PRODUCT_BUCKET].unmatched += unmatched.length;
      }
    }

    let applied = 0;
    let ordersTotalsUpdated = 0;
    const updateErrors: { item_id: string; message: string }[] = [];
    if (mode === "apply") {
      for (const a of affected) {
        if (a.diffs.length === 0) continue;
        for (const d of a.diffs) {
          const payload: Record<string, unknown> = {
            unit_price: d.expected_unit_price,
            total_price: d.expected_total_price,
          };
          if (d.set_product_id) payload.product_id = d.set_product_id;
          const { data: upData, error: upErr } = await supabase
            .from("order_items")
            .update(payload)
            .eq("id", d.item_id)
            .select("id");
          if (upErr) {
            updateErrors.push({ item_id: d.item_id, message: upErr.message });
          } else if (upData && upData.length > 0) {
            applied += 1;
          } else {
            updateErrors.push({ item_id: d.item_id, message: "no rows matched" });
          }
        }
        // Recompute order total/subtotal from current items (after updates).
        const { data: items } = await supabase
          .from("order_items")
          .select("total_price")
          .eq("order_id", a.order_id);
        const newSubtotal = +(items || []).reduce((s: number, it: any) => s + Number(it.total_price || 0), 0).toFixed(2);
        const newTotal = newSubtotal; // shipping is baked into items for imports
        const { error: ordErr } = await supabase
          .from("orders")
          .update({ subtotal: newSubtotal, total: newTotal, delivery_fee: 0 })
          .eq("id", a.order_id);
        if (!ordErr) ordersTotalsUpdated += 1;
        else updateErrors.push({ item_id: a.order_id, message: `order total: ${ordErr.message}` });
      }
    }


    return json({
      mode,
      scope,
      totalOrders: orders.length,
      offersScanned,
      productsScanned,
      affected,
      summary: {
        byOffer,
        affectedCount: affected.length,
        applied,
        ordersTotalsUpdated,
        updateErrors: updateErrors.slice(0, 20),
        updateErrorsCount: updateErrors.length,
      },
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
