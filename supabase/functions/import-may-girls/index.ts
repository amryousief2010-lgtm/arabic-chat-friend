import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const norm = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const body = await req.json();
    const rows: any[] = body.rows || [];
    const dryRun: boolean = !!body.dryRun;

    const { data: prods } = await supabase.from("products").select("id,name,price");
    const PROD: Record<string, any> = {};
    for (const p of prods || []) PROD[norm(p.name)] = p;
    const findProd = (n: string) => PROD[norm(n)] || null;

    let matched = 0, created = 0, createdItems = 0, replacedItems = 0;
    let custCreated = 0, custReused = 0, skippedNoPhone = 0, emptyRows = 0;
    const missing = new Set<string>();
    const custByPhone = new Map<string, string>();
    const touchedCustomers = new Set<string>();

    // Counter for IMP14- order numbers
    const { count: existingImp } = await supabase
      .from("orders").select("id", { count: "exact", head: true })
      .like("order_number", "IMP14-%");
    let counter = existingImp || 0;

    for (const r of rows) {
      if (!r.phone) { skippedNoPhone++; continue; }
      if (!r.items || r.items.length === 0) emptyRows++;

      // customer
      let cid = custByPhone.get(r.phone) || null;
      if (!cid) {
        const { data: existing } = await supabase.from("customers").select("id").eq("phone", r.phone).maybeSingle();
        if (existing) {
          cid = existing.id;
          custReused++;
          await supabase.from("customers").update({
            name: r.customer_name || undefined,
          }).eq("id", cid);
          // Fill nullable fields only if null
          const patch: any = {};
          if (r.address) patch.address = r.address;
          if (r.governorate) patch.governorate = r.governorate;
          if (r.city) patch.city = r.city;
          if (r.source) patch.source = r.source;
          if (r.shipping) patch.shipping_company = r.shipping;
          if (r.phone2) patch.phone2 = r.phone2;
          // get current to only fill missing
          const { data: cur } = await supabase.from("customers").select("address,governorate,city,source,shipping_company,phone2").eq("id", cid).single();
          const merge: any = {};
          for (const k of Object.keys(patch)) if (!cur?.[k]) merge[k] = patch[k];
          if (Object.keys(merge).length) await supabase.from("customers").update(merge).eq("id", cid);
        } else {
          const { data: ins, error } = await supabase.from("customers").insert({
            name: r.customer_name || "عميل",
            phone: r.phone,
            phone2: r.phone2,
            address: r.address,
            governorate: r.governorate,
            city: r.city,
            source: r.source,
            shipping_company: r.shipping,
          }).select("id").single();
          if (error) { console.error("cust err", error.message); continue; }
          cid = ins.id;
          custCreated++;
        }
        custByPhone.set(r.phone, cid!);
      }
      touchedCustomers.add(cid!);

      // find existing order
      const ts = r.timestamp ? new Date(r.timestamp.replace(" ", "T") + "Z") : null;
      const dateStr = ts ? ts.toISOString().slice(0,10) : null;
      let orderId: string | null = null;
      if (dateStr) {
        const { data: ex } = await supabase.from("orders")
          .select("id")
          .eq("customer_id", cid)
          .eq("moderator", r.moderator_db)
          .eq("total", r.total)
          .gte("created_at", dateStr + "T00:00:00Z")
          .lt("created_at", dateStr + "T23:59:59Z")
          .limit(1).maybeSingle();
        if (ex) orderId = ex.id;
      }

      const notesParts: string[] = [];
      if (r.offer) notesParts.push(`العرض: ${r.offer}`);
      if (r.notes) notesParts.push(`ملاحظات: ${r.notes}`);
      if (r.cust_notes) notesParts.push(`ملاحظات العميل: ${r.cust_notes}`);
      if (r.cancel_reason) notesParts.push(`سبب الإلغاء: ${r.cancel_reason}`);
      const notes = notesParts.join(" | ") || null;

      if (orderId) { matched++; continue; }
      counter++;
      const on = `IMP14-${String(counter).padStart(5,"0")}`;
      const { data: ins, error } = await supabase.from("orders").insert({
        order_number: on, customer_id: cid,
        status: r.status, payment_method: "cash", payment_status: r.payment,
        subtotal: r.total, total: r.total, notes, delivery_address: r.address,
        created_by: r.creator_id, created_at: ts?.toISOString() || new Date().toISOString(),
        source: r.source, shipping_company: r.shipping, moderator: r.moderator_db,
      }).select("id").single();
      if (error) { console.error("order err", error.message, on); continue; }
      orderId = ins.id;
      created++;

      const total = Number(r.total) || 0;
      const specs: any[] = [];
      for (const it of (r.items || [])) {
        const p = findProd(it.product);
        if (!p) { missing.add(it.product); continue; }
        specs.push({ it, p });
      }
      const itemRows: any[] = [];
      if (specs.length === 0) {
        itemRows.push({
          order_id: orderId, product_id: null,
          product_name: r.offer || "طلب",
          quantity: 1, unit_price: total, total_price: total,
          is_half_kg: false, offer_name: r.offer,
        });
      } else {
        const weights = specs.map(s => {
          const w = Number(s.it.qty) * Number(s.p.price || 1);
          return w > 0 ? w : 1;
        });
        const sumW = weights.reduce((a,b)=>a+b,0) || 1;
        const lineTotals: number[] = specs.map((_, i) =>
          total > 0 ? Math.round(total * (weights[i]/sumW) * 100) / 100 : 0
        );
        if (total > 0 && lineTotals.length > 0) {
          const sum = lineTotals.reduce((a,b)=>a+b,0);
          const diff = Math.round((total - sum) * 100) / 100;
          lineTotals[lineTotals.length-1] = Math.round((lineTotals[lineTotals.length-1] + diff) * 100) / 100;
        }
        specs.forEach((s, i) => {
          const lineTotal = lineTotals[i];
          const qty = Number(s.it.qty);
          const up = qty > 0 ? Math.round((lineTotal/qty)*100)/100 : 0;
          itemRows.push({
            order_id: orderId, product_id: s.p.id, product_name: norm(s.p.name),
            quantity: qty, unit_price: up, total_price: lineTotal,
            is_half_kg: !!s.it.is_half_kg, offer_name: r.offer,
          });
        });
      }
      const { error: iErr } = await supabase.from("order_items").insert(itemRows);
      if (iErr) console.error("items err", iErr.message);
      else {
        if (matched > created) replacedItems += itemRows.length;
        createdItems += itemRows.length;
      }
    }

    // Refresh customer totals
    for (const cid of touchedCustomers) {
      const { data: stats } = await supabase.from("orders").select("total").eq("customer_id", cid);
      const n = stats?.length || 0;
      const s = (stats || []).reduce((a:number,o:any)=>a+Number(o.total||0),0);
      await supabase.from("customers").update({ total_orders: n, total_spent: s }).eq("id", cid);
    }

    return new Response(JSON.stringify({
      ok: true, matched, created, createdItems, replacedItems,
      custCreated, custReused, skippedNoPhone, emptyRows,
      missing: [...missing], totalProcessed: rows.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
