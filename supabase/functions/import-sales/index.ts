import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Product columns mapping (0-based indices)
const PRODUCT_COLUMNS = [
  { name: "لحم", index: 8 },
  { name: "دبوس/فخدة/نعامة", index: 9 },
  { name: "استيك", index: 10 },
  { name: "موزة", index: 11 },
  { name: "فراشة", index: 12 },
  { name: "قطعية الدبوس", index: 13 },
  { name: "تربيانكو", index: 14 },
  { name: "اسكالوب", index: 15 },
  { name: "ميت رول", index: 16 },
  { name: "كبدة", index: 17 },
  { name: "قلب", index: 18 },
  { name: "قوانص", index: 19 },
  { name: "رقاب", index: 20 },
  { name: "دهن", index: 21 },
  { name: "كوارع", index: 22 },
  { name: "كفتة", index: 23 },
  { name: "سجق", index: 24 },
  { name: "برجر", index: 25 },
  { name: "لانشون سادة", index: 26 },
  { name: "لانشون فلفل أسود", index: 27 },
  { name: "لانشون بيبروني", index: 28 },
  { name: "مفروم حواوشي", index: 29 },
  { name: "مفروم", index: 30 },
  { name: "كريم المفاصل", index: 31 },
  { name: "زيت الشعر", index: 32 },
  { name: "كريم الشعر", index: 33 },
  { name: "كريم للبشرة", index: 34 },
  { name: "لحم غزال", index: 40 },
];

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "number") {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString();
  }
  if (typeof value === "string") {
    const parts = value.split(" ");
    if (parts.length >= 1) {
      const dateParts = parts[0].split("/");
      if (dateParts.length === 3) {
        const month = dateParts[0].padStart(2, "0");
        const day = dateParts[1].padStart(2, "0");
        const year = dateParts[2].length === 2 ? `20${dateParts[2]}` : dateParts[2];
        const time = parts[1] || "12:00:00";
        return `${year}-${month}-${day}T${time}Z`;
      }
    }
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileUrl, batchSize = 50 } = await req.json();

    if (!fileUrl) {
      return new Response(JSON.stringify({ error: "fileUrl is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role to bypass RLS
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch and parse Excel
    const response = await fetch(fileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];

    // Parse records
    interface ParsedRecord {
      timestamp: string;
      moderator: string;
      customerSource: string;
      customerName: string;
      customerPhone: string;
      customerPhone2?: string;
      address: string;
      shippingCompany: string;
      orderValue: number;
      offerType: string;
      notes?: string;
      governorate: string;
      city: string;
      products: { name: string; quantity: number }[];
    }

    const records: ParsedRecord[] = [];

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i] as any[];
      if (!row || row.length < 5) continue;
      const customerName = row[3];
      if (!customerName || String(customerName).trim() === "") continue;

      const products: { name: string; quantity: number }[] = [];
      for (const col of PRODUCT_COLUMNS) {
        const qty = parseFloat(row[col.index]) || 0;
        if (qty > 0) products.push({ name: col.name, quantity: qty });
      }

      const orderValue = parseFloat(row[35]) || 0;
      if (orderValue <= 0) continue;

      records.push({
        timestamp: parseExcelDate(row[0]) || new Date().toISOString(),
        moderator: String(row[1] || "").trim(),
        customerSource: String(row[2] || "").trim(),
        customerName: String(row[3] || "").trim(),
        customerPhone: String(row[4] || "").replace(/\s/g, ""),
        customerPhone2: row[5] ? String(row[5]).replace(/\s/g, "") : undefined,
        address: String(row[6] || "").trim(),
        shippingCompany: String(row[7] || "").trim(),
        orderValue,
        offerType: String(row[36] || "").trim(),
        notes: row[37] ? String(row[37]).trim() : undefined,
        governorate: String(row[38] || "").trim(),
        city: String(row[39] || "").trim(),
        products,
      });
    }

    console.log(`Parsed ${records.length} records from Excel`);

    // Process in batches
    let customersCreated = 0;
    let ordersCreated = 0;
    let itemsCreated = 0;
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
          } else {
            const { data: newCust, error: custErr } = await supabase
              .from("customers")
              .insert({
                name: record.customerName,
                phone: record.customerPhone,
                address: record.address,
                city: record.city,
                notes: `المحافظة: ${record.governorate} | المصدر: ${record.customerSource}${record.customerPhone2 ? ` | هاتف آخر: ${record.customerPhone2}` : ""}`,
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

        // Create order
        const orderDate = new Date(record.timestamp);
        const orderNumber = `ORD-${orderDate.getFullYear()}${String(orderDate.getMonth() + 1).padStart(2, "0")}${String(orderDate.getDate()).padStart(2, "0")}-${String(ordersCreated + 1).padStart(4, "0")}`;

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
            notes: `العرض: ${record.offerType} | شركة الشحن: ${record.shippingCompany} | المندوب: ${record.moderator}${record.notes ? ` | ملاحظات: ${record.notes}` : ""}`,
          })
          .select("id")
          .single();

        if (orderErr) {
          console.error("Order error:", orderErr.message);
          continue;
        }
        ordersCreated++;

        // Create order items
        const items = record.products.length > 0
          ? record.products.map((p) => {
              const totalQty = record.products.reduce((s, x) => s + x.quantity, 0);
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
