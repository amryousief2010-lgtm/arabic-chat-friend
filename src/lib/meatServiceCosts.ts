// Parses service-cost lines stored on meat_manufacturing_invoices.notes as:
//   [service_cost] {name}: {qty} {unit} × {unit_cost} = {total}
// Numbers may be in Arabic-Indic digits with ٫ as decimal separator.

export type ServiceCostRow = {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  unit_cost: number | null;
  total: number | null;
};

const PREFIX = "[service_cost]";

const toNum = (s: string): number | null => {
  if (!s) return null;
  const western = s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[٫,]/g, ".")
    .replace(/[^\d.\-]/g, "");
  const n = Number(western);
  return Number.isFinite(n) ? n : null;
};

export function parseServiceCostLine(line: string): ServiceCostRow {
  const raw = line.replace(PREFIX, "").trim();
  const eqIdx = raw.lastIndexOf("=");
  const total = eqIdx >= 0 ? toNum(raw.slice(eqIdx + 1)) : null;
  const beforeEq = eqIdx >= 0 ? raw.slice(0, eqIdx).trim() : raw;
  const colonIdx = beforeEq.indexOf(":");
  const name = colonIdx >= 0 ? beforeEq.slice(0, colonIdx).trim() : beforeEq;
  const rest = colonIdx >= 0 ? beforeEq.slice(colonIdx + 1).trim() : "";
  let quantity: number | null = null, unit: string | null = null, unit_cost: number | null = null;
  if (rest) {
    const xIdx = rest.search(/[×x*]/);
    const left = xIdx >= 0 ? rest.slice(0, xIdx).trim() : rest;
    const right = xIdx >= 0 ? rest.slice(xIdx + 1).trim() : "";
    const m = left.match(/^([\d\u0660-\u0669٫.,\-]+)\s*(.*)$/);
    if (m) { quantity = toNum(m[1]); unit = (m[2] || "").trim() || null; }
    if (right) unit_cost = toNum(right);
  }
  return { raw, name: name || raw, quantity, unit, unit_cost, total };
}

export function parseServiceCostsFromNotes(notes?: string | null): ServiceCostRow[] {
  return String(notes || "")
    .split("\n")
    .filter((l) => l.startsWith(PREFIX))
    .map(parseServiceCostLine);
}

/**
 * Strips [service_cost] lines from the notes so the visible user notes remain.
 */
export function userNotesFromInvoice(notes?: string | null): string {
  return String(notes || "")
    .split("\n")
    .filter((l) => !l.startsWith(PREFIX))
    .join("\n")
    .trim();
}
