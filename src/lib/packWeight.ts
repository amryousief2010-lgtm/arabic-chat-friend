/** Standard pack weight in kilograms. Mirrors default_pack_weight_kg(). */
export function defaultPackWeightKg(name: string | null | undefined): number {
  const n = name || "";
  if (n.includes("دبوس") && n.includes("عظم")) return 6;
  if (n.includes("دهن")) return 1;
  return 0.5;
}

export function resolvePackWeightKg(item: { name?: string | null; pack_weight_kg?: number | null }): number {
  const stored = Number(item.pack_weight_kg);
  if (Number.isFinite(stored) && stored > 0) return stored;
  return defaultPackWeightKg(item.name);
}
