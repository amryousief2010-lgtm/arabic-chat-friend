/**
 * `search_orders` returns each order's items as jsonb, already grouped, so
 * that payload is not a flat 1,000-row PostgREST window. The client must
 * keep that array. A JSON string is accepted because some drivers stringify
 * jsonb. Anything else stays empty — lines are not invented.
 */
export function itemsFromSearchPayload(value: unknown): Record<string, unknown>[] {
  const list = coerceList(value);
  const rows: Record<string, unknown>[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    rows.push(entry as Record<string, unknown>);
  }
  return rows;
}

function coerceList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
