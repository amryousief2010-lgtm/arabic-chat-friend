/**
 * Target-page kg price resolution (لحوم / لحوم بالعظم / مصنعات).
 * Single source used by useKgPrices and unit tests — not order/invoice product prices.
 */

export interface KgPrices {
  meat_price: number;
  bone_meat_price: number;
  processed_price: number;
}

export interface KgPriceVersion extends KgPrices {
  effective_from: string; // YYYY-MM-DD
  effective_to?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type KgPriceKind = "processed" | "meat" | "bone_meat";

/** Fallback when DB/RPC unavailable — matches latest seeded policy (Oct 2026+). */
export const defaultKgPrices: KgPrices = {
  meat_price: 390,
  bone_meat_price: 350,
  processed_price: 120,
};

/** Built-in seed when the versions table/RPC is empty (mirrors migration seeds). */
export const BUILTIN_KG_PRICE_VERSIONS: KgPriceVersion[] = [
  {
    effective_from: "2020-01-01",
    meat_price: 390,
    bone_meat_price: 350,
    processed_price: 160,
  },
  {
    effective_from: "2026-09-01",
    meat_price: 390,
    bone_meat_price: 350,
    processed_price: 140,
  },
  {
    effective_from: "2026-10-01",
    meat_price: 390,
    bone_meat_price: 350,
    processed_price: 120,
  },
];

/** First calendar day of a 1-based month as YYYY-MM-DD. */
export function monthStartIso(year: number, month1Based: number): string {
  const m = String(month1Based).padStart(2, "0");
  return `${year}-${m}-01`;
}

export function arabicMonthLabel(month1Based: number): string {
  const labels = [
    "",
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];
  return labels[month1Based] ?? String(month1Based);
}

export function formatEffectiveMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  if (!y || !m) return isoDate;
  return `${arabicMonthLabel(m)} ${y}`;
}

export function priceKindLabel(kind: KgPriceKind): string {
  if (kind === "processed") return "المصنعات";
  if (kind === "meat") return "اللحوم";
  return "اللحوم بالعظم";
}

/**
 * Pick the version whose effective_from is the latest on or before the
 * first day of the given calendar month (1-based month).
 */
export function resolveKgPricesForMonth(
  versions: KgPriceVersion[],
  year: number,
  month1Based: number,
): { prices: KgPrices; effective_from: string; isHistorical: boolean } {
  const start = monthStartIso(year, month1Based);
  const sorted = [...versions].sort((a, b) =>
    a.effective_from < b.effective_from ? 1 : a.effective_from > b.effective_from ? -1 : 0,
  );
  const match = sorted.find((v) => v.effective_from <= start) ?? sorted[sorted.length - 1];
  const source = match ?? {
    ...defaultKgPrices,
    effective_from: "2026-10-01",
  };
  // Historical = any version that started before Sep 2026 (legacy 160 era).
  const isHistorical = source.effective_from < "2026-09-01";
  return {
    prices: {
      meat_price: Number(source.meat_price),
      bone_meat_price: Number(source.bone_meat_price),
      processed_price: Number(source.processed_price),
    },
    effective_from: source.effective_from,
    isHistorical,
  };
}
