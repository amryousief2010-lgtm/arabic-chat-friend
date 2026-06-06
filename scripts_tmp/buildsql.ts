import fs from "fs";
const rows = JSON.parse(fs.readFileSync("/tmp/parsed_batches.json","utf8"));
const esc = (s:string) => "'" + String(s).replace(/'/g,"''") + "'";
const lit = (v:any) => v==null ? "NULL" : (typeof v==="number" ? String(v) : esc(String(v)));

// distinct customers
const names = Array.from(new Set(rows.map((r:any)=>r.customer_name)));
const custValues = names.map((n:string)=>{
  const isCap = (n.replace(/\s+/g,"")).includes("عاصمة") || n.replace(/\s+/g,"").includes("العاصمة");
  return `(${esc(n)}, ${esc(isCap?"internal":"external")})`;
}).join(",\n");

// dedup_keys
const seen = new Set<string>();
const unique = rows.filter((r:any) => { if(r.errors.length) return false; if(seen.has(r.dedup_key)) return false; seen.add(r.dedup_key); return true; });

let sql = `-- 1) Upsert customers
INSERT INTO hatch_customers (name, customer_type) VALUES
${custValues}
ON CONFLICT (name) DO NOTHING;
`;
fs.writeFileSync("/tmp/step1_customers.sql", sql);

// Build batch inserts referencing customer ids via subquery
const valueLines = unique.map((r:any) => {
  return `(${esc(r.dedup_key)}, (SELECT id FROM hatch_customers WHERE name=${esc(r.customer_name)} LIMIT 1), ${lit(r.receive_date)}, ${r.received_eggs}, ${r.net_eggs || (r.received_eggs - r.damaged)}, ${lit(r.entry_date)}, ${lit(r.machine)}, ${lit(r.candle1_date)}, ${r.candle1_fertile}, ${r.candle1_infertile}, ${lit(r.candle2_date)}, ${r.candle2_dead}, ${lit(r.exit_date)}, ${r.hatched_chicks}, ${r.hatcher_dead}, ${lit(r.notes)}, ${esc(r.exit_date?"completed":"pending")})`;
});

// chunk into multiple inserts to keep statements manageable
const chunks: string[] = [];
const CH = 100;
for (let i=0;i<valueLines.length;i+=CH){
  const slice = valueLines.slice(i,i+CH).join(",\n");
  chunks.push(`INSERT INTO hatch_batches (batch_number, customer_id, receive_date, received_eggs, net_eggs, entry_date, machine, candle1_date, candle1_fertile, candle1_infertile, candle2_date, candle2_dead, exit_date, hatched_chicks, hatcher_dead, notes, status) VALUES\n${slice}\nON CONFLICT (batch_number) DO NOTHING;`);
}
fs.writeFileSync("/tmp/step2_batches.sql", chunks.join("\n\n"));
console.log("customers:", names.length, "batches:", unique.length, "chunks:", chunks.length);
