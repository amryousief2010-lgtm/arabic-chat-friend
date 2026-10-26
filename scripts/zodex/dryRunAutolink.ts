/**
 * READ-ONLY dry run of the Zodex match engine over the last N days.
 * Input: JSON exported by scripts/zodex/dryRunQuery.sql (phones are md5-hashed in SQL; no PII).
 * Output: counts + order numbers only. Writes nothing to the database.
 *   npx tsx scripts/zodex/dryRunAutolink.ts <input.json> [days=45]
 */
import { readFileSync } from "node:fs";
import { evaluateBill, auditExistingLink, type CandidateOrder, type MatchTier } from "../../supabase/functions/_shared/zodexMatchEngine";

type Row = { id: string; n: string; t: number | null; c: string; s: string; f: string | null; b: string | null; ph: string[];
  sa: string | null; r: string | null; bo: number; ob: number };

let raw = JSON.parse(readFileSync(process.argv[2], "utf8"));
const rows: Row[] = Array.isArray(raw) ? (raw[0]?.j ?? raw) : (raw.rows?.[0]?.j ?? raw);
const days = Number(process.argv[3] ?? 45);
const since = Date.now() - days * 86_400_000;

// Hash → synthetic mobile so the engine's normaliser sees comparable numbers (no real numbers involved).
const fake = new Map<string, string>();
const pseudo = (h: string) => { if (!fake.has(h)) fake.set(h, "010" + String(fake.size).padStart(8, "0")); return fake.get(h)!; };
const toCand = (r: Row): CandidateOrder => ({ id: r.id, order_number: r.n, total: r.t, created_at: r.c, status: r.s,
  phones: (r.ph ?? []).map(pseudo), shipping_bill_no: r.b, fulfillment_type: r.f,
  });

const byPhone = new Map<string, Row[]>();
for (const r of rows) for (const h of r.ph ?? []) (byPhone.get(h) ?? byPhone.set(h, []).get(h)!).push(r);
const holders = new Map<string, string[]>();
for (const r of rows) if (r.b) (holders.get(r.b) ?? holders.set(r.b, []).get(r.b)!).push(r.id);

const linked = rows.filter((r) => r.b && Date.parse(r.c) >= since);
const tiers: Record<MatchTier, string[]> = { AUTO: [], REVIEW: [], BLOCKED: [], NO_ORDER: [] };
const suspicious: Record<string, string[]> = {};
for (const r of linked) {
  const amountMatched = r.r ? /cod|amount|manual/i.test(r.r) && !/phone_only/i.test(r.r) : null;
  const ship = r.sa ?? r.c;
  const cands = new Map<string, Row>();
  for (const h of r.ph ?? []) for (const x of byPhone.get(h) ?? []) cands.set(x.id, x);
  const bill = { bill_no: r.b!, phones: (r.ph ?? []).map(pseudo), cod: amountMatched ? r.t : amountMatched === false ? -1 : null, shipment_date: ship };
  // cod=-1 marks "audit says amount did not match" → engine sees unknown amount; we flag it in the audit step.
  const d = evaluateBill({ ...bill, cod: bill.cod === -1 ? null : bill.cod }, [...cands.values()].map(toCand), { billHolders: holders });
  tiers[d.tier].push(r.n);
  const other = [...cands.values()].filter((x) => x.id !== r.id && x.s !== "cancelled" && Math.abs(Date.parse(x.c) - Date.parse(r.c)) < 30 * 86_400_000).length;
  const flags = auditExistingLink({ bill: { ...bill, cod: null }, order: toCand(r), otherOpenSamePhone: other,
    billOrderCount: Math.max(r.bo, holders.get(r.b!)?.length ?? 0), orderBillCount: r.ob, amountKnownMatched: amountMatched });
  for (const f of flags) (suspicious[f] ??= []).push(r.n);
}
const anySusp = new Set(Object.values(suspicious).flat());
// Optional: unlinked waybills from the last good sync run (argv[4]) → what the engine would do now.
let unlinked: any = undefined;
if (process.argv[4]) {
  let u = JSON.parse(readFileSync(process.argv[4], "utf8")); u = u.rows?.[0]?.j ?? u;
  const res: Record<string, string[]> = { AUTO: [], REVIEW: [], BLOCKED: [], NO_ORDER: [] };
  const pairs: string[] = [];
  for (const f of u as { bill: string; ph: string[]; at: string; cod: number }[]) {
    const cands = new Map<string, Row>();
    for (const h of f.ph ?? []) for (const x of byPhone.get(h) ?? []) cands.set(x.id, x);
    const d = evaluateBill({ bill_no: f.bill, phones: (f.ph ?? []).map(pseudo), cod: f.cod, shipment_date: f.at }, [...cands.values()].map(toCand), { billHolders: holders });
    res[d.tier].push(f.bill);
    pairs.push(`${f.bill} → ${d.tier}${d.best ? " " + d.best.order_number : ""}`);
  }
  unlinked = { evaluated: (u as any[]).length, tiers: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.length])), pairs };
}
const out = {
  unlinked_waybills_last_run: unlinked,
  window_days: days, linked_orders_evaluated: linked.length,
  tiers: Object.fromEntries(Object.entries(tiers).map(([k, v]) => [k, v.length])),
  existing_links_flagged_suspicious: anySusp.size,
  suspicious_by_reason: Object.fromEntries(Object.entries(suspicious).map(([k, v]) => [k, v.length])),
  samples: {
    BLOCKED: tiers.BLOCKED.slice(0, 15), REVIEW: tiers.REVIEW.slice(0, 15),
    ...Object.fromEntries(Object.entries(suspicious).map(([k, v]) => [`suspect_${k}`, v.slice(0, 10)])),
  },
};
console.log(JSON.stringify(out, null, 2));
