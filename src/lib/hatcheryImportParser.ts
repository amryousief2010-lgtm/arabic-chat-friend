import * as XLSX from "xlsx";

export type SheetKey =
  | "customers"
  | "batches"
  | "production"
  | "shipments"
  | "chick_movements";

export interface ParsedRow {
  _sheet: SheetKey;
  _row: number;
  _key: string; // dedup key
  data: Record<string, any>;
  errors: string[];
}

export interface ParseSummary {
  customers: { total: number; internal: number; external: number };
  batches: {
    total: number;
    capital: number;
    external: number;
    totalEggs: number;
    capitalEggs: number;
    externalEggs: number;
    totalDamaged: number;
    totalNet: number;
    totalChicks: number;
    capitalChicks: number;
    externalChicks: number;
    totalCharge: number;
    totalReceived: number;
    totalRemaining: number;
  };
  production: { total: number; futureSkipped: number; emptySkipped: number; totalEggs: number };
  shipments: { total: number; totalEggs: number; totalDamaged: number; totalOut: number };
  chickMovements: { total: number; incoming: number; dead: number; sold: number; totalSale: number };
  errors: number;
}

const SHEETS = {
  customers: "عملاء المعمل",
  batches: "دفعات المعمل",
  production: "إنتاج الأمهات",
  shipments: "نقل البيض للمعمل",
  chick_movements: "حركة الكتاكيت",
};

const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v).trim();
  if (!s || s.startsWith("#")) return 0;
  const n = Number(s.replace(/,/g, ""));
  return isFinite(n) ? n : 0;
};

const txt = (v: any): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.startsWith("#")) return null;
  return s;
};

const toISODate = (v: any): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  if (!s || s.startsWith("#")) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

function readSheet(wb: XLSX.WorkBook, name: string): any[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
}

export function parseHatcheryWorkbook(buf: ArrayBuffer): {
  rows: ParsedRow[];
  summary: ParseSummary;
} {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const rows: ParsedRow[] = [];
  const summary: ParseSummary = {
    customers: { total: 0, internal: 0, external: 0 },
    batches: {
      total: 0, capital: 0, external: 0,
      totalEggs: 0, capitalEggs: 0, externalEggs: 0,
      totalDamaged: 0, totalNet: 0,
      totalChicks: 0, capitalChicks: 0, externalChicks: 0,
      totalCharge: 0, totalReceived: 0, totalRemaining: 0,
    },
    production: { total: 0, futureSkipped: 0, emptySkipped: 0, totalEggs: 0 },
    shipments: { total: 0, totalEggs: 0, totalDamaged: 0, totalOut: 0 },
    chickMovements: { total: 0, incoming: 0, dead: 0, sold: 0, totalSale: 0 },
    errors: 0,
  };
  const today = new Date().toISOString().slice(0, 10);

  // ---- Customers (header row 3, data from row 4)
  const cust = readSheet(wb, SHEETS.customers);
  for (let i = 3; i < cust.length; i++) {
    const r = cust[i] || [];
    const name = txt(r[1]);
    if (!name) continue;
    const type = txt(r[2]) === "داخلي" ? "internal" : "external";
    const data = {
      external_id: txt(r[0]),
      name,
      customer_type: type,
      phone: txt(r[3]),
      address: txt(r[4]),
      notes: txt(r[5]),
      incubation_price: num(r[6]),
      infertile_price: num(r[7]),
      hatcher_price: num(r[8]),
    };
    const errors: string[] = [];
    rows.push({ _sheet: "customers", _row: i + 1, _key: name.toLowerCase(), data, errors });
    summary.customers.total++;
    if (type === "internal") summary.customers.internal++;
    else summary.customers.external++;
  }

  // ---- Batches
  const bt = readSheet(wb, SHEETS.batches);
  for (let i = 3; i < bt.length; i++) {
    const r = bt[i] || [];
    const customerName = txt(r[1]);
    const batchNum = r[3];
    const receiveDate = toISODate(r[4]);
    if (!customerName || batchNum === null || batchNum === undefined || !receiveDate) continue;

    const type = txt(r[2]) === "داخلي" ? "internal" : "external";
    const data = {
      external_id: txt(r[0]),
      customer_name: customerName,
      customer_type: type,
      batch_seq: num(batchNum),
      receive_date: receiveDate,
      received_eggs: num(r[5]),
      damaged: num(r[6]),
      net_eggs: num(r[7]),
      entry_date: toISODate(r[8]),
      machine: txt(r[9]),
      candle1_date: toISODate(r[10]),
      candle1_infertile: num(r[11]),
      candle1_fertile: num(r[12]),
      candle2_date: toISODate(r[13]),
      candle2_dead: num(r[14]),
      net_after_candle2: num(r[15]),
      exit_date: toISODate(r[16]),
      hatcher_dead: num(r[17]),
      hatched_chicks: num(r[18]),
      fertility_pct: num(r[19]),
      hatch_pct: num(r[20]),
      hatcher_dead_pct: num(r[21]),
      quality_notes: txt(r[22]),
      charge_incubation: num(r[23]),
      charge_infertile: num(r[24]),
      charge_hatcher: num(r[25]),
      charge_total: num(r[26]),
      received_money: num(r[27]),
      remaining: num(r[28]),
      compare_group: txt(r[29]),
      completed: txt(r[30]) === "نعم",
    };
    const errors: string[] = [];
    if (data.received_eggs <= 0) errors.push("إجمالي البيض الوارد صفر");
    const key = `${customerName.toLowerCase()}|${data.batch_seq}|${receiveDate}`;
    rows.push({ _sheet: "batches", _row: i + 1, _key: key, data, errors });
    summary.batches.total++;
    summary.batches.totalEggs += data.received_eggs;
    summary.batches.totalDamaged += data.damaged;
    summary.batches.totalNet += data.net_eggs;
    summary.batches.totalChicks += data.hatched_chicks;
    summary.batches.totalCharge += data.charge_total;
    summary.batches.totalReceived += data.received_money;
    summary.batches.totalRemaining += data.remaining;
    if (type === "internal") {
      summary.batches.capital++;
      summary.batches.capitalEggs += data.received_eggs;
      summary.batches.capitalChicks += data.hatched_chicks;
    } else {
      summary.batches.external++;
      summary.batches.externalEggs += data.received_eggs;
      summary.batches.externalChicks += data.hatched_chicks;
    }
    if (errors.length) summary.errors++;
  }

  // ---- Production
  const prod = readSheet(wb, SHEETS.production);
  for (let i = 3; i < prod.length; i++) {
    const r = prod[i] || [];
    const date = toISODate(r[0]);
    const family = r[1];
    if (!date || family === null || family === undefined) continue;
    const egg = num(r[4]);
    if (egg <= 0) {
      if (date > today) summary.production.futureSkipped++;
      else summary.production.emptySkipped++;
      continue;
    }
    const data = {
      production_date: date,
      family_number: String(family),
      pen: txt(r[2]),
      female_count: num(r[3]),
      egg_count: egg,
      notes: txt(r[8]),
    };
    rows.push({
      _sheet: "production", _row: i + 1,
      _key: `${date}|${data.family_number}`, data, errors: [],
    });
    summary.production.total++;
    summary.production.totalEggs += egg;
  }

  // ---- Shipments (egg transfer to lab)
  const ship = readSheet(wb, SHEETS.shipments);
  for (let i = 3; i < ship.length; i++) {
    const r = ship[i] || [];
    const date = toISODate(r[0]);
    const family = r[1];
    if (!date || family === null || family === undefined) continue;
    const moved = num(r[3]);
    const damaged = num(r[4]);
    if (moved <= 0 && damaged <= 0) continue;
    const data = {
      production_date: date,
      family_number: String(family),
      pen: txt(r[2]),
      egg_count: moved,
      damaged_count: damaged,
      reason: txt(r[6]),
      notes: txt(r[7]),
    };
    rows.push({
      _sheet: "shipments", _row: i + 1,
      _key: `${date}|${data.family_number}|${moved}|${damaged}`, data, errors: [],
    });
    summary.shipments.total++;
    summary.shipments.totalEggs += moved;
    summary.shipments.totalDamaged += damaged;
  }

  // ---- Chick movements
  const cm = readSheet(wb, SHEETS.chick_movements);
  for (let i = 3; i < cm.length; i++) {
    const r = cm[i] || [];
    const date = toISODate(r[0]);
    const source = txt(r[1]);
    if (!date || !source) continue;
    const data = {
      movement_date: date,
      source, // "العاصمة" | "عملاء المعمل الآخرون" | customer name
      batch_seq: num(r[2]),
      incoming: num(r[3]),
      outgoing: num(r[4]),
      dead: num(r[5]),
      sold: num(r[6]),
      unit_price: num(r[7]),
      total_sale: num(r[8]),
      description: txt(r[9]),
      notes: txt(r[11]),
    };
    rows.push({
      _sheet: "chick_movements", _row: i + 1,
      _key: `${date}|${source}|${data.batch_seq}|${data.incoming}|${data.outgoing}|${data.sold}|${data.description ?? ""}`,
      data, errors: [],
    });
    summary.chickMovements.total++;
  }

  return { rows, summary };
}
