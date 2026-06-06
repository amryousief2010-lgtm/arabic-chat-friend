import fs from "fs";
const rows = JSON.parse(fs.readFileSync("/tmp/parsed_batches.json","utf8"));
const esc = (s:string) => "'" + String(s).replace(/'/g,"''") + "'";
const names = Array.from(new Set(rows.map((r:any)=>r.customer_name)));
// Insert only missing
const sel = names.map(esc).join(",");
let sql = `WITH wanted(name, customer_type) AS (VALUES\n` +
  names.map((n:string)=>{
    const isCap = (n.replace(/\s+/g,"")).includes("عاصمة") || n.replace(/\s+/g,"").includes("العاصمة");
    return `(${esc(n)}::text, ${esc(isCap?"internal":"external")}::text)`;
  }).join(",\n") +
  `\n)\nINSERT INTO hatch_customers (name, customer_type)\nSELECT w.name, w.customer_type FROM wanted w\nWHERE NOT EXISTS (SELECT 1 FROM hatch_customers c WHERE c.name = w.name);`;
fs.writeFileSync("/tmp/step1_customers.sql", sql);
console.log("ok");
