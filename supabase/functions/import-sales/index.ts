import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Authn: require valid JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authz: only general_manager can bulk import
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

    const { records, batchSize = 50 } = await req.json();

    if (!records || !Array.isArray(records) || records.length === 0) {
      return new Response(JSON.stringify({ error: "records array is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const MAX_RECORDS = 10000;
    if (records.length > MAX_RECORDS) {
      return new Response(
        JSON.stringify({ error: `Too many records. Max is ${MAX_RECORDS}` }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { count: existingCount } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true });

    let globalCounter = existingCount || 0;

    console.log(`Processing ${records.length} records, existing orders: ${globalCounter}`);

    let customersCreated = 0;
    let ordersCreated = 0;
    let itemsCreated = 0;
    let skipped = 0;
    const processedCustomers = new Map<string, string>();

    for (let b = 0; b < records.length; b += batchSize) {
      const batch = records.slice(b, b + batchSize);

      for (const record of batch) {
        const customerKey = record.customerPhone;
        let customerId: string;

        if (processedCustomers.has(customerKey)) {
          customerId = processedCustomers.get(customerKey)!;
        } else {
          const { data: existing } = await supabase
            .from("customers")
            .select("id")
            .eq("phone", record.customerPhone)
            .maybeSingle();

          if (existing) {
            customerId = existing.id;
            // Update customer city/address if missing
            await supabase
              .from("customers")
              .update({
                city: record.governorate || record.city || null,
                address: record.address || null,
              })
              .eq("id", customerId)
              .is("city", null);
          } else {
            const { data: newCust, error: custErr } = await supabase
              .from("customers")
              .insert({
                name: record.customerName,
                phone: record.customerPhone,
                address: record.address,
                city: record.governorate || record.city,
                notes: `المصدر: ${record.customerSource}${record.customerPhone2 ? ` | هاتف آخر: ${record.customerPhone2}` : ""}`,
              })
              .select("id")
              .single();

            if (custErr) {
              console.error("Customer error:", custErr.message);
              continue;
            }
            customerId = newCust.id;
            customersCreated++;
          }
          processedCustomers.set(customerKey, customerId);
        }

        // Duplicate check
        if (record.skipDuplicateCheck !== true) {
          const { data: existingOrder } = await supabase
            .from("orders")
            .select("id")
            .eq("customer_id", customerId)
            .eq("total", record.orderValue)
            .gte("created_at", record.timestamp.split("T")[0] + "T00:00:00Z")
            .lte("created_at", record.timestamp.split("T")[0] + "T23:59:59Z")
            .maybeSingle();

          if (existingOrder) {
            skipped++;
            continue;
          }
        }

        globalCounter++;
        const orderNumber = `IMP-${Date.now()}-${String(globalCounter).padStart(5, "0")}`;

        const { data: newOrder, error: orderErr } = await supabase
          .from("orders")
          .insert({
            order_number: orderNumber,
            customer_id: customerId,
            subtotal: record.orderValue,
            total: record.orderValue,
            status: "delivered",
            payment_status: "paid",
            payment_method: "cash",
            delivery_address: record.address,
            created_at: record.timestamp,
            source: record.customerSource || null,
            shipping_company: record.shippingCompany || null,
            moderator: record.moderator || null,
            notes: `العرض: ${record.offerType}${record.notes ? ` | ملاحظات: ${record.notes}` : ""}`,
          })
          .select("id")
          .single();

        if (orderErr) {
          console.error("Order error:", orderErr.message);
          continue;
        }
        ordersCreated++;

        const products = record.products || [];
        const items = products.length > 0
          ? products.map((p: any) => {
              const totalQty = products.reduce((s: number, x: any) => s + x.quantity, 0);
              const unitPrice = record.orderValue / totalQty;
              return {
                order_id: newOrder.id,
                product_name: p.name,
                quantity: p.quantity,
                unit_price: unitPrice,
                total_price: unitPrice * p.quantity,
              };
            })
          : [
              {
                order_id: newOrder.id,
                product_name: record.offerType || "طلب",
                quantity: 1,
                unit_price: record.orderValue,
                total_price: record.orderValue,
              },
            ];

        const { error: itemErr, data: insertedItems } = await supabase
          .from("order_items")
          .insert(items)
          .select("id");

        if (!itemErr && insertedItems) {
          itemsCreated += insertedItems.length;
        }
      }

      console.log(`Batch done: ${Math.min(b + batchSize, records.length)}/${records.length}`);
    }

    // Update customer totals
    for (const [, customerId] of processedCustomers) {
      const { data: stats } = await supabase
        .from("orders")
        .select("total")
        .eq("customer_id", customerId);

      if (stats) {
        const totalSpent = stats.reduce((s: number, o: any) => s + Number(o.total), 0);
        await supabase
          .from("customers")
          .update({ total_orders: stats.length, total_spent: totalSpent })
          .eq("id", customerId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalRecords: records.length,
        customersCreated,
        ordersCreated,
        itemsCreated,
        skipped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Import error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
