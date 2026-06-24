// Shared helper to find treasury advances (سلف) for HR employees by name matching.
// Advances live across slaughter_custody_expenses, lab_treasury_movements,
// and main_treasury_transactions — they are NOT linked by employee_id, so we
// match heuristically using the same logic as HREmployeeAdvancesReport.

import { supabase } from "@/integrations/supabase/client";

export interface MatchEmployee {
  id: string;
  full_name: string;
}

export interface TreasuryAdvanceRow {
  id: string;
  source: "slaughter" | "lab" | "main";
  sourceLabel: string;
  date: string;
  description: string | null;
  beneficiary: string | null;
  amount: number;
  status: string | null;
  reference: string | null;
  matchedEmployeeId: string | null;
}

export const ADVANCE_REGEX = /سلف|advance/i;

export const normalize = (s: string) =>
  (s || "")
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function tryMatchEmployee(text: string, employees: MatchEmployee[]): MatchEmployee | null {
  const n = normalize(text);
  if (!n) return null;
  let best: { emp: MatchEmployee; score: number } | null = null;
  for (const e of employees) {
    const ne = normalize(e.full_name);
    if (!ne) continue;
    const tokens = ne.split(" ").filter((t) => t.length >= 2);
    if (!tokens.length) continue;
    let score = 0;
    for (const t of tokens) if (n.includes(t)) score++;
    if (score >= 2) {
      if (!best || score > best.score) best = { emp: e, score };
    } else if (score === 1 && tokens[0].length >= 3 && n.includes(tokens[0])) {
      const others = employees.filter(
        (o) => o.id !== e.id && normalize(o.full_name).split(" ")[0] === tokens[0]
      );
      if (others.length === 0 && (!best || best.score < 1)) best = { emp: e, score: 1 };
    }
  }
  return best?.emp ?? null;
}

const SRC_LABEL = { slaughter: "خزنة المجزر", lab: "خزنة المعمل", main: "الخزنة الرئيسية" };

/**
 * Fetch all treasury advance rows and match them to employees.
 * Returns map: employeeId -> rows[]
 */
export async function fetchAdvancesByEmployee(
  employees: MatchEmployee[]
): Promise<{ map: Record<string, TreasuryAdvanceRow[]>; all: TreasuryAdvanceRow[] }> {
  const [aliasRes, slRes, labRes, mainRes] = await Promise.all([
    supabase.from("hr_employee_name_aliases" as any).select("normalized_name, employee_id"),
    supabase
      .from("slaughter_custody_expenses")
      .select("id, expense_date, category, description, amount, beneficiary, status")
      .or(
        "description.ilike.%سلف%,description.ilike.%advance%,category.ilike.%سلف%,category.ilike.%advance%"
      ),
    supabase
      .from("lab_treasury_movements")
      .select("id, movement_date, description, amount, beneficiary, status, expense_category")
      .or("description.ilike.%سلف%,description.ilike.%advance%,expense_category.ilike.%advance%")
      .eq("movement_type", "expense"),
    supabase
      .from("main_treasury_transactions")
      .select("id, txn_date, description, amount, counterparty, status, reference_no")
      .or("description.ilike.%سلف%,description.ilike.%advance%"),
  ]);

  const aliases = ((aliasRes.data as any[]) || []) as Array<{ normalized_name: string; employee_id: string }>;
  const aliasMap = new Map<string, string>();
  for (const a of aliases) aliasMap.set(a.normalized_name, a.employee_id);
  const empById = new Map(employees.map((e) => [e.id, e]));

  const resolveMatch = (text: string, rawName: string | null): MatchEmployee | null => {
    const nRaw = normalize(rawName || "");
    if (nRaw && aliasMap.has(nRaw)) {
      const e = empById.get(aliasMap.get(nRaw)!);
      if (e) return e;
    }
    for (const [k, eid] of aliasMap) {
      if (k && normalize(text).includes(k)) {
        const e = empById.get(eid);
        if (e) return e;
      }
    }
    return tryMatchEmployee(text, employees);
  };

  const out: TreasuryAdvanceRow[] = [];
  for (const r of (slRes.data as any[]) || []) {
    const text = `${r.description ?? ""} ${r.beneficiary ?? ""}`;
    if (!ADVANCE_REGEX.test(text) && !ADVANCE_REGEX.test(r.category ?? "")) continue;
    const m = resolveMatch(text, r.beneficiary);
    out.push({
      id: r.id, source: "slaughter", sourceLabel: SRC_LABEL.slaughter,
      date: r.expense_date, description: r.description, beneficiary: r.beneficiary,
      amount: Number(r.amount) || 0, status: r.status, reference: null,
      matchedEmployeeId: m?.id ?? null,
    });
  }
  for (const r of (labRes.data as any[]) || []) {
    const text = `${r.description ?? ""} ${r.beneficiary ?? ""}`;
    if (!ADVANCE_REGEX.test(text)) continue;
    const m = resolveMatch(text, r.beneficiary);
    out.push({
      id: r.id, source: "lab", sourceLabel: SRC_LABEL.lab,
      date: r.movement_date, description: r.description, beneficiary: r.beneficiary,
      amount: Number(r.amount) || 0, status: r.status, reference: null,
      matchedEmployeeId: m?.id ?? null,
    });
  }
  for (const r of (mainRes.data as any[]) || []) {
    const text = `${r.description ?? ""} ${r.counterparty ?? ""}`;
    if (!ADVANCE_REGEX.test(text)) continue;
    const m = resolveMatch(text, r.counterparty);
    out.push({
      id: r.id, source: "main", sourceLabel: SRC_LABEL.main,
      date: r.txn_date, description: r.description, beneficiary: r.counterparty,
      amount: Number(r.amount) || 0, status: r.status, reference: r.reference_no,
      matchedEmployeeId: m?.id ?? null,
    });
  }

  // Exclude rejected/cancelled rows from deductible totals
  const isActive = (s: string | null) => !s || !["rejected", "cancelled", "voided"].includes(s);
  const map: Record<string, TreasuryAdvanceRow[]> = {};
  for (const r of out) {
    if (!r.matchedEmployeeId) continue;
    if (!isActive(r.status)) continue;
    (map[r.matchedEmployeeId] ||= []).push(r);
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => b.date.localeCompare(a.date));
  return { map, all: out };
}

export const sumAdvances = (rows?: TreasuryAdvanceRow[]) =>
  (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
