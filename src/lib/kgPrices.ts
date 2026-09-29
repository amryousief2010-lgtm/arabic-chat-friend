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
}

/** Fallback when DB versions are unavailable — matches post-Sep 2026 policy. */
export const defaultKgPrices: KgPrices = {
  meat_price: 390,
  bone_meat_price: 350,
  processed_price: 140,
};

/** Built-in seed when the versions table is empty (mirrors migration seeds). */
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
];

/** First calendar day of a 1-based month as YYYY-MM-DD. */
export function monthStartIso(year: number, month1Based: number): string {
  const m = String(month1Based).padStart(2, "0");
  return `${year}-${m}-01`;
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
    effective_from: "2026-09-01",
  };
  const currentCutoff = "2026-09-01";
  const isHistorical = source.effective_from < currentCutoff;
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

/** Current editable version key (managers update this row for Sep 2026+). */
export const CURRENT_KG_PRICE_EFFECTIVE_FROM = "2026-09-01";

===== END FILE =====
