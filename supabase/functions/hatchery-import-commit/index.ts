import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: u, error: ue } = await supabase.auth.getUser(token);
    if (ue || !u.user) return json({ error: "Unauthorized" }, 401);

    // Authz: GM / executive / hatchery / farm managers may commit
    const { data: roles } = await supabase
      .from("user_roles").select("role").eq("user_id", u.user.id);
    const allowed = new Set([
      "general_manager", "executive_manager",
      "hatchery_manager", "farm_manager", "production_manager",
    ]);
    if (!(roles || []).some((r: any) => allowed.has(r.role))) {
      return json({ error: "Forbidden" }, 403);
    }

    const { run_id } = await req.json();
    if (!run_id) return json({ error: "run_id required" }, 400);

    const { data: run, error: re } = await supabase
      .from("import_staging_runs").select("*").eq("id", run_id).maybeSingle();
    if (re || !run) return json({ error: "Run not found" }, 404);
    if (run.status === "posted") return json({ error: "Already posted" }, 400);
    if (run.status === "cancelled") return json({ error: "Cancelled" }, 400);

    // Load rows
    const { data: stagingRows, error: sre } = await supabase
      .from("import_staging_rows").select("*").eq("run_id", run_id);
    if (sre) throw sre;

    const bySheet: Record<string, any[]> = {};
    for (const r of stagingRows || []) {
      const sheet = r.raw_data?.sheet;
      if (!sheet) continue;
      (bySheet[sheet] ||= []).push({ ...r.parsed_data, _row: r.row_number });
    }

    const posted = {
      customers: { inserted: 0, updated: 0 },
      batches: { inserted: 0, skipped_existing: 0 },
      production: { inserted: 0, skipped_existing: 0, missing_family: 0 },
      shipments: { inserted: 0, skipped_existing: 0, missing_family: 0 },
      chick_movements: { inserted: 0, skipped_existing: 0 },
    };

    // ---- 1) Customers: upsert by name (case-insensitive)
    const customerIdByName = new Map<string, string>();
    {
      const { data: existing } = await supabase
        .from("hatch_customers").select("id,name");
      for (const c of existing || []) customerIdByName.set(c.name.trim().toLowerCase(), c.id);

      for (const row of bySheet.customers || []) {
        const key = row.name.trim().toLowerCase();
        const payload = {
          name: row.name,
          customer_type: row.customer_type === "internal" ? "internal" : "external",
          incubation_price: row.incubation_price ?? 0,
          infertile_price: row.infertile_price ?? 0,
          hatcher_price: row.hatcher_price ?? 0,
          notes: row.notes,
          is_active: true,
        };
        if (customerIdByName.has(key)) {
          await supabase.from("hatch_customers").update(payload).eq("id", customerIdByName.get(key)!);
          posted.customers.updated++;
        } else {
          const { data, error } = await supabase
            .from("hatch_customers").insert(payload).select("id").single();
          if (!error && data) {
            customerIdByName.set(key, data.id);
            posted.customers.inserted++;
          }
        }
      }
    }

    // ---- 2) Batches
    {
      // Make sure customer ids exist for customers referenced by batches even if customers sheet was empty
      const neededNames = new Set<string>();
      for (const row of bySheet.batches || []) neededNames.add(row.customer_name.trim().toLowerCase());
      const missing = [...neededNames].filter(n => !customerIdByName.has(n));
      if (missing.length) {
        const { data: more } = await supabase.from("hatch_customers")
          .select("id,name").in("name", missing.map(n => n));
        for (const c of more || []) customerIdByName.set(c.name.trim().toLowerCase(), c.id);
        // create placeholders for still-missing
        for (const row of bySheet.batches || []) {
          const k = row.customer_name.trim().toLowerCase();
          if (customerIdByName.has(k)) continue;
          const { data, error } = await supabase.from("hatch_customers").insert({
            name: row.customer_name,
            customer_type: row.customer_type === "internal" ? "internal" : "external",
            incubation_price: 0, infertile_price: 0, hatcher_price: 0, is_active: true,
          }).select("id").single();
          if (!error && data) { customerIdByName.set(k, data.id); posted.customers.inserted++; }
        }
      }

      const { data: existingBatches } = await supabase
        .from("hatch_batches").select("batch_number");
      const existingSet = new Set((existingBatches || []).map((b: any) => b.batch_number));

      for (const row of bySheet.batches || []) {
        const custId = customerIdByName.get(row.customer_name.trim().toLowerCase());
        if (!custId) continue;
        // Stable batch_number: external_id if present else CUST-SEQ-DATE
        const bn = row.external_id || `${row.customer_name}-${row.batch_seq}-${row.receive_date}`;
        if (existingSet.has(bn)) { posted.batches.skipped_existing++; continue; }

        const status = row.completed ? "completed"
          : row.exit_date ? "hatching"
          : row.entry_date ? "incubating"
          : "pending";

        const { error } = await supabase.from("hatch_batches").insert({
          batch_number: bn,
          customer_id: custId,
          receive_date: row.receive_date,
          received_eggs: row.received_eggs || 0,
          net_eggs: row.net_eggs || 0,
          entry_date: row.entry_date,
          machine: row.machine,
          candle1_date: row.candle1_date,
          candle1_fertile: row.candle1_fertile || 0,
          candle1_infertile: row.candle1_infertile || 0,
          candle2_date: row.candle2_date,
          candle2_fertile: null,
          candle2_dead: row.candle2_dead || 0,
          exit_date: row.exit_date,
          hatched_chicks: row.hatched_chicks || 0,
          hatcher_dead: row.hatcher_dead || 0,
          status,
          notes: row.quality_notes,
        });
        if (!error) { posted.batches.inserted++; existingSet.add(bn); }
      }
    }

    // ---- 3) Farm production
    {
      const { data: fams } = await supabase.from("farm_families").select("id,family_number");
      const famByNum = new Map<string, string>();
      for (const f of fams || []) famByNum.set(String(f.family_number), f.id);

      const { data: existingProd } = await supabase
        .from("farm_egg_production").select("production_date,family_id");
      const existingProdSet = new Set(
        (existingProd || []).map((p: any) => `${p.production_date}|${p.family_id}`)
      );

      for (const row of bySheet.production || []) {
        const fid = famByNum.get(row.family_number);
        if (!fid) { posted.production.missing_family++; continue; }
        const key = `${row.production_date}|${fid}`;
        if (existingProdSet.has(key)) { posted.production.skipped_existing++; continue; }
        const { error } = await supabase.from("farm_egg_production").insert({
          production_date: row.production_date,
          family_id: fid,
          egg_count: row.egg_count || 0,
          notes: row.notes,
          created_by: u.user.id,
        });
        if (!error) { posted.production.inserted++; existingProdSet.add(key); }
      }
    }

    // ---- 4) Shipments (egg transfers to lab)
    {
      const { data: fams } = await supabase.from("farm_families").select("id,family_number");
      const famByNum = new Map<string, string>();
      for (const f of fams || []) famByNum.set(String(f.family_number), f.id);

      const { data: existing } = await supabase
        .from("farm_to_hatchery_shipments")
        .select("production_date,family_id,egg_count,damaged_count");
      const existingSet = new Set(
        (existing || []).map((s: any) =>
          `${s.production_date}|${s.family_id}|${s.egg_count}|${s.damaged_count ?? 0}`)
      );

      for (const row of bySheet.shipments || []) {
        const fid = famByNum.get(row.family_number);
        if (!fid) { posted.shipments.missing_family++; continue; }
        const key = `${row.production_date}|${fid}|${row.egg_count || 0}|${row.damaged_count || 0}`;
        if (existingSet.has(key)) { posted.shipments.skipped_existing++; continue; }
        const { error } = await supabase.from("farm_to_hatchery_shipments").insert({
          production_date: row.production_date,
          family_id: fid,
          family_number: row.family_number,
          egg_count: row.egg_count || 0,
          damaged_count: row.damaged_count || 0,
          status: "received",
          received_egg_count: row.egg_count || 0,
          received_at: new Date(row.production_date).toISOString(),
          received_by: u.user.id,
          receipt_notes: [row.reason, row.notes].filter(Boolean).join(" | ") || null,
        });
        if (!error) { posted.shipments.inserted++; existingSet.add(key); }
      }
    }

    // ---- 5) Chick movements
    {
      const { data: existing } = await supabase
        .from("chick_movements")
        .select("movement_date,source,incoming,outgoing,sold,notes");
      const k = (m: any) => `${m.movement_date}|${m.source}|${m.incoming || 0}|${m.outgoing || 0}|${m.sold || 0}|${m.notes ?? ""}`;
      const existingSet = new Set((existing || []).map(k));

      for (const row of bySheet.chick_movements || []) {
        const candidate = {
          movement_date: row.movement_date,
          source: row.description || row.source,
          incoming: row.incoming || 0,
          outgoing: row.outgoing || 0,
          dead: row.dead || 0,
          sold: row.sold || 0,
          unit_price: row.unit_price || 0,
          notes: row.notes,
        };
        if (existingSet.has(k(candidate))) { posted.chick_movements.skipped_existing++; continue; }
        const { error } = await supabase.from("chick_movements").insert(candidate);
        if (!error) { posted.chick_movements.inserted++; existingSet.add(k(candidate)); }
      }
    }

    // Update run + audit
    await supabase.from("import_staging_runs").update({
      status: "posted",
      approved_by: u.user.id,
      approved_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
      validation_summary: { ...(run.validation_summary || {}), posted },
    }).eq("id", run_id);

    return json({ ok: true, posted });
  } catch (e) {
    console.error("hatchery-import-commit error", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
