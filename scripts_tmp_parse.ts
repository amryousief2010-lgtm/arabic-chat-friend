import * as XLSX from "xlsx";
import fs from "fs";
const buf = fs.readFileSync("/tmp/clean.xlsx");
const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
console.log("Sheets:", wb.SheetNames);
const ws = wb.Sheets["دفعات المعمل"];
const sheet: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any;
console.log("Rows:", sheet.length);
for (let i = 0; i < 6; i++) console.log("R"+i, JSON.stringify(sheet[i]));
console.log("Last:", JSON.stringify(sheet[sheet.length-1]));

const num = (v:any) => { if (v==null||v==="") return 0; if (typeof v==="number") return isFinite(v)?v:0; const s=String(v).trim(); if(!s||s.startsWith("#"))return 0; const n=Number(s.replace(/,/g,"")); return isFinite(n)?n:0; };
const txt = (v:any) => { if(v==null) return null; const s=String(v).trim(); if(!s||s.startsWith("#")) return null; return s; };
const toISO = (v:any) => { if(!v) return null; if(v instanceof Date) return v.toISOString().slice(0,10); if(typeof v==="number"){const d=XLSX.SSF.parse_date_code(v); if(!d) return null; return `${d.y}-${String(d.m).padStart(2,"0")}-${String(d.d).padStart(2,"0")}`;} const s=String(v).trim(); if(!s||s.startsWith("#")) return null; const d=new Date(s); if(isNaN(d.getTime())) return null; return d.toISOString().slice(0,10); };
const isCap = (n:string) => { const x=n.replace(/\s+/g,""); return x.includes("العاصمة")||x.includes("عاصمة"); };

const rows:any[] = [];
let totalEggs=0, totalDamaged=0, totalNet=0, totalChicks=0, totalCharge=0, totalReceived=0, totalRemaining=0;
let cap=0, ext=0, capEggs=0, extEggs=0, capChicks=0, extChicks=0;
for (let i=3; i<sheet.length; i++) {
  const r = sheet[i]||[];
  const customer_name = txt(r[1]);
  const batchNum = r[3];
  const receive_date = toISO(r[4]);
  if (!customer_name || batchNum==null || !receive_date) continue;
  const c = isCap(customer_name);
  const external_id = txt(r[0]);
  const batch_seq = num(batchNum);
  const received_eggs = num(r[5]);
  const damaged = num(r[6]);
  const net_eggs = num(r[7]);
  const hatched = num(r[18]);
  const charge = num(r[26]);
  const recv = num(r[27]);
  const rem = num(r[28]);
  const dedup_key = external_id ? `EXT:${external_id}` : `${customer_name}|${batch_seq}|${receive_date}`;
  rows.push({rowNumber:i+1, external_id, customer_name, is_capital:c, batch_seq, receive_date,
    received_eggs, damaged, net_eggs, entry_date:toISO(r[8]), machine:txt(r[9]),
    candle1_date:toISO(r[10]), candle1_infertile:num(r[11]), candle1_fertile:num(r[12]),
    candle2_date:toISO(r[13]), candle2_dead:num(r[14]), exit_date:toISO(r[16]),
    hatcher_dead:num(r[17]), hatched_chicks:hatched, notes:txt(r[22]),
    charge_total:charge, received_money:recv, remaining:rem, dedup_key, errors:received_eggs<=0?["إجمالي البيض الوارد صفر"]:[]});
  totalEggs+=received_eggs; totalDamaged+=damaged; totalNet+=net_eggs; totalChicks+=hatched;
  totalCharge+=charge; totalReceived+=recv; totalRemaining+=rem;
  if (c) { cap++; capEggs+=received_eggs; capChicks+=hatched; } else { ext++; extEggs+=received_eggs; extChicks+=hatched; }
}
console.log("SUMMARY:", JSON.stringify({total:rows.length, cap, ext, totalEggs, capEggs, extEggs, totalDamaged, totalNet, totalChicks, capChicks, extChicks, totalCharge, totalReceived, totalRemaining}, null, 2));
fs.writeFileSync("/tmp/parsed_batches.json", JSON.stringify(rows));
console.log("Wrote", rows.length, "rows");
