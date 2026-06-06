// Per-customer aggregation for hatchery lab batches.
// Excludes is_test=true rows and orphan rows (no customer_id, entry_date or machine).
// Pure analytics — never creates treasury/collection movements.

export interface HatchBatchRow {
  id: string;
  customer_id: string | null;
  is_test: boolean | null;
  entry_date: string | null;
  receive_date: string | null;
  machine: string | null;
  batch_number: string;
  operational_batch_no: number | null;
  status: string | null;
  received_eggs: number | null;
  net_eggs: number | null;
  candle1_fertile: number | null;
  candle1_infertile: number | null;
  candle2_dead: number | null;
  hatcher_dead: number | null;
  hatched_chicks: number | null;
  exit_date: string | null;
  notes: string | null;
}

export interface HatchCustomerLite {
  id: string;
  name: string;
  customer_type: string | null;
  incubation_price?: number | null;
  infertile_price?: number | null;
  hatcher_price?: number | null;
}

export interface CustomerPaymentLite {
  customer_id: string;
  amount: number | string;
  payment_date: string;
}

export interface CustomerStats {
  customer_id: string;
  name: string;
  is_internal: boolean;
  batches: number;             // distinct operational batches
  rows: number;                // total rows
  total_eggs: number;
  net_eggs: number;
  infertile: number;
  fertile: number;
  candle2_dead: number;
  hatcher_dead: number;
  chicks: number;
  fertility_pct: number;       // fertile / total_eggs
  hatch_rate_pct: number;      // chicks / fertile
  estimated_charge: number;    // incubation*fertile + infertile*infertile_price + (fertile-chicks)*hatcher_price
  paid: number;
  remaining: number;
  rowsRaw: HatchBatchRow[];
}

export interface AggregateOptions {
  includeInternal?: boolean;
  from?: string;     // entry_date >= from
  to?: string;       // entry_date <= to
  statusFilter?: "all" | "completed" | "in_progress";
  search?: string;
}

function isOrphan(b: HatchBatchRow) {
  return !b.customer_id && !b.entry_date && !b.machine;
}

export function filterOperationalRows(rows: HatchBatchRow[]): HatchBatchRow[] {
  return rows.filter((b) => b.is_test !== true && !isOrphan(b));
}

export function aggregateByCustomer(
  rows: HatchBatchRow[],
  customers: HatchCustomerLite[],
  payments: CustomerPaymentLite[] = [],
  opts: AggregateOptions = {},
): CustomerStats[] {
  const custMap = new Map(customers.map((c) => [c.id, c]));
  const paidMap = new Map<string, number>();
  for (const p of payments) {
    paidMap.set(p.customer_id, (paidMap.get(p.customer_id) || 0) + Number(p.amount || 0));
  }

  const cleaned = filterOperationalRows(rows).filter((b) => {
    if (!b.customer_id) return false;
    if (opts.from && (b.entry_date || "") < opts.from) return false;
    if (opts.to && (b.entry_date || "") > opts.to) return false;
    if (opts.statusFilter === "completed" && b.status !== "completed") return false;
    if (opts.statusFilter === "in_progress" && b.status === "completed") return false;
    return true;
  });

  const map = new Map<string, CustomerStats>();
  for (const b of cleaned) {
    const cid = b.customer_id!;
    const c = custMap.get(cid);
    if (!c) continue;
    const isInternal = c.customer_type === "internal" || /عاصمة|داخل/.test(c.name || "");
    if (isInternal && !opts.includeInternal) {
      // include internal only if explicitly requested
    }
    if (!map.has(cid)) {
      map.set(cid, {
        customer_id: cid,
        name: c.name,
        is_internal: isInternal,
        batches: 0,
        rows: 0,
        total_eggs: 0,
        net_eggs: 0,
        infertile: 0,
        fertile: 0,
        candle2_dead: 0,
        hatcher_dead: 0,
        chicks: 0,
        fertility_pct: 0,
        hatch_rate_pct: 0,
        estimated_charge: 0,
        paid: paidMap.get(cid) || 0,
        remaining: 0,
        rowsRaw: [],
      });
    }
    const s = map.get(cid)!;
    s.rows += 1;
    s.total_eggs += b.received_eggs || 0;
    s.net_eggs += b.net_eggs || 0;
    s.infertile += b.candle1_infertile || 0;
    s.fertile += b.candle1_fertile || 0;
    s.candle2_dead += b.candle2_dead || 0;
    s.hatcher_dead += b.hatcher_dead || 0;
    s.chicks += b.hatched_chicks || 0;
    if (!isInternal) {
      const fertile = b.candle1_fertile || 0;
      const infertile = b.candle1_infertile || 0;
      const chicks = b.hatched_chicks || 0;
      s.estimated_charge +=
        fertile * Number(c.incubation_price || 0) +
        infertile * Number(c.infertile_price || 0) +
        Math.max(0, fertile - chicks) * Number(c.hatcher_price || 0);
    }
    s.rowsRaw.push(b);
  }

  // distinct operational batches
  for (const s of map.values()) {
    const set = new Set<string>();
    for (const r of s.rowsRaw) {
      set.add(
        r.operational_batch_no != null
          ? `OP${r.operational_batch_no}_${r.machine || "—"}`
          : `D_${r.entry_date || "—"}_${r.machine || "—"}`,
      );
    }
    s.batches = set.size;
    s.fertility_pct = s.total_eggs > 0 ? (s.fertile / s.total_eggs) * 100 : 0;
    s.hatch_rate_pct = s.fertile > 0 ? (s.chicks / s.fertile) * 100 : 0;
    s.remaining = Math.max(0, s.estimated_charge - s.paid);
  }

  let arr = Array.from(map.values());
  if (!opts.includeInternal) arr = arr.filter((s) => !s.is_internal);
  if (opts.search) {
    const q = opts.search.trim().toLowerCase();
    arr = arr.filter((s) => s.name.toLowerCase().includes(q));
  }
  return arr;
}

export function batchStageLabel(b: HatchBatchRow): string {
  if (b.status === "completed" || b.exit_date) return "مكتملة";
  if (b.status === "in_hatcher") return "في الهاتشر";
  if (b.status === "pending" || !b.status) return "قادمة";
  return b.status;
}
