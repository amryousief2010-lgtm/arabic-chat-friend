/**
 * Slaughter-batch cost share.
 *
 * A batch is charged only for the live birds it actually draws from each
 * receipt. The share is the live weight taken from that receipt when that
 * weight is recorded, and otherwise the bird count (equal share of the
 * receipt). A receipt's birds, recorded live weight, and cost cannot be
 * allocated past what it still has.
 *
 * Output cost per kg uses the accepted-weight rule already used by
 * recalc_slaughter_output_auto_costs: non-waste outputs, after damaged and
 * quarantined kilograms are removed. The same rate is applied to every
 * accepted kilogram.
 */

export type SlaughterReceiptCost = {
  id: string;
  birdCount: number;
  totalWeightKg?: number;
  totalCost?: number;
  openingCost?: number;
  feedCost?: number;
  mortalityCost?: number;
  otherCost?: number;
  birdFeedCost?: number;
  deadOnArrival?: number;
  mortalityCount?: number;
  /** When non-zero, mortality is already reflected in the stock adjustment. */
  manualAdjustment?: number;
};

export type SlaughterSourceDraw = {
  receiptId: string;
  birds: number;
  /** Kilograms taken from this receipt. Omit to share by bird count. */
  liveWeightKg?: number | null;
};

export type PriorSlaughterUse = SlaughterSourceDraw & {
  /** Cost already snapped for this draw. Recomputed when omitted. */
  cost?: number;
};

export type SlaughterOutputKg = {
  actualWeightKg: number;
  damagedKg?: number;
  quarantinedKg?: number;
  destination?: string | null;
};

export type SourceCostLine = {
  receiptId: string;
  birds: number;
  liveWeightKg: number | null;
  basis: "live_weight" | "bird";
  share: number;
  cost: number;
  costPerBird: number;
};

export type SlaughterBatchCost = {
  sources: SourceCostLine[];
  birdsCost: number;
  directExpenses: number;
  totalCost: number;
  acceptedKg: number;
  costPerKg: number;
};

export class SlaughterAllocationError extends Error {
  readonly code: "birds" | "weight" | "cost" | "receipt";

  constructor(code: SlaughterAllocationError["code"], message: string) {
    super(message);
    this.name = "SlaughterAllocationError";
    this.code = code;
  }
}

const n = (value: number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const roundMoney = (value: number, places = 4) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export function receiptAllocatableCost(receipt: SlaughterReceiptCost): number {
  return (
    n(receipt.totalCost) +
    n(receipt.openingCost) +
    n(receipt.feedCost) +
    n(receipt.mortalityCost) +
    n(receipt.otherCost) +
    n(receipt.birdFeedCost)
  );
}

/** Equal share of the receipt, used when no per-receipt live weight is recorded. */
export function fairCostPerBird(receipt: SlaughterReceiptCost): number {
  const birds = n(receipt.birdCount);
  if (birds <= 0) return 0;
  const cost = receiptAllocatableCost(receipt);
  return cost > 0 ? cost / birds : 0;
}

export function availableBirds(
  receipt: SlaughterReceiptCost,
  usedBirds: number,
): number {
  const mortality = n(receipt.manualAdjustment) !== 0 ? 0 : n(receipt.mortalityCount);
  return Math.max(
    n(receipt.birdCount) -
      n(receipt.deadOnArrival) -
      mortality -
      n(usedBirds) +
      n(receipt.manualAdjustment),
    0,
  );
}

export function acceptedOutputKg(outputs: SlaughterOutputKg[]): number {
  return outputs.reduce((sum, output) => {
    if ((output.destination || "") === "waste") return sum;
    const accepted = Math.max(
      0,
      n(output.actualWeightKg) - n(output.damagedKg) - n(output.quarantinedKg),
    );
    return sum + accepted;
  }, 0);
}

const priorCostOf = (receipt: SlaughterReceiptCost, prior: PriorSlaughterUse) => {
  if (prior.cost != null && Number.isFinite(prior.cost)) return n(prior.cost);
  return quoteSourceCost(receipt, prior).cost;
};

function quoteSourceCost(
  receipt: SlaughterReceiptCost,
  draw: SlaughterSourceDraw,
): { basis: "live_weight" | "bird"; share: number; cost: number } {
  const allocatable = receiptAllocatableCost(receipt);
  const weight = n(draw.liveWeightKg);
  const receiptWeight = n(receipt.totalWeightKg);
  if (weight > 0 && receiptWeight > 0) {
    const share = weight / receiptWeight;
    return { basis: "live_weight", share, cost: roundMoney(allocatable * share) };
  }
  const birds = n(receipt.birdCount);
  if (birds <= 0) {
    throw new SlaughterAllocationError("receipt", "إيصال الاستلام لا يحتوي عدد طيور");
  }
  const share = n(draw.birds) / birds;
  return { basis: "bird", share, cost: roundMoney(allocatable * share) };
}

export function allocateSlaughterBatch(input: {
  receipts: SlaughterReceiptCost[];
  sources: SlaughterSourceDraw[];
  priorUses?: PriorSlaughterUse[];
  directExpenses?: number;
  outputs?: SlaughterOutputKg[];
}): SlaughterBatchCost {
  const receipts = new Map(input.receipts.map((receipt) => [receipt.id, receipt]));
  const prior: PriorSlaughterUse[] = [...(input.priorUses ?? [])];
  const lines: SourceCostLine[] = [];

  for (const source of input.sources) {
    const receipt = receipts.get(source.receiptId);
    if (!receipt) {
      throw new SlaughterAllocationError("receipt", "دفعة النعام المصدر غير موجودة");
    }
    const birds = n(source.birds);
    if (birds <= 0 || !Number.isInteger(birds)) {
      throw new SlaughterAllocationError("birds", "عدد النعام المطلوب دبحه يجب أن يكون أكبر من صفر");
    }

    const sameReceipt = prior.filter((use) => use.receiptId === source.receiptId);
    const usedBirds = sameReceipt.reduce((sum, use) => sum + n(use.birds), 0);
    const available = availableBirds(receipt, usedBirds);
    if (birds > available) {
      throw new SlaughterAllocationError(
        "birds",
        `العدد المطلوب دبحه (${birds}) أكبر من المتاح (${available})`,
      );
    }

    const weight = n(source.liveWeightKg);
    const receiptWeight = n(receipt.totalWeightKg);
    if (weight > 0) {
      const usedWeight = sameReceipt.reduce((sum, use) => sum + n(use.liveWeightKg), 0);
      if (receiptWeight <= 0 || usedWeight + weight > receiptWeight + 0.001) {
        throw new SlaughterAllocationError(
          "weight",
          "الوزن الحي المطلوب أكبر من الوزن المتبقي في إيصال الاستلام",
        );
      }
    }

    const quoted = quoteSourceCost(receipt, source);
    const usedCost = sameReceipt.reduce((sum, use) => sum + priorCostOf(receipt, use), 0);
    const remaining = roundMoney(receiptAllocatableCost(receipt) - usedCost);
    if (quoted.cost > remaining + 0.05) {
      throw new SlaughterAllocationError(
        "cost",
        "تكلفة هذه الدفعة تتجاوز تكلفة الإيصال المتبقية",
      );
    }
    const cost = roundMoney(Math.min(quoted.cost, Math.max(remaining, 0)));
    lines.push({
      receiptId: source.receiptId,
      birds,
      liveWeightKg: weight > 0 ? weight : null,
      basis: quoted.basis,
      share: quoted.share,
      cost,
      costPerBird: birds > 0 ? cost / birds : 0,
    });
    prior.push({ ...source, birds, liveWeightKg: weight > 0 ? weight : null, cost });
  }

  const birdsCost = roundMoney(lines.reduce((sum, line) => sum + line.cost, 0));
  const directExpenses = n(input.directExpenses);
  const totalCost = roundMoney(birdsCost + directExpenses);
  const acceptedKg = acceptedOutputKg(input.outputs ?? []);
  const costPerKg = acceptedKg > 0 ? totalCost / acceptedKg : 0;

  return { sources: lines, birdsCost, directExpenses, totalCost, acceptedKg, costPerKg };
}

/** Cost per accepted kg from the locked per-source snapshots already stored on a batch. */
export function costPerKgFromSnapshots(input: {
  sources: Array<{ totalBirdsCost?: number | null; costPerBird?: number | null; birds?: number | null }>;
  directExpenses?: number;
  outputs: SlaughterOutputKg[];
  /** Used when output rows are not loaded but the batch stored a meat total. */
  meatKgFallback?: number;
}): number | null {
  const birdsCost = input.sources.reduce((sum, source) => {
    const snapped = n(source.totalBirdsCost);
    if (snapped > 0) return sum + snapped;
    return sum + n(source.costPerBird) * n(source.birds);
  }, 0);
  if (birdsCost <= 0) return null;
  const accepted = acceptedOutputKg(input.outputs);
  const kg = accepted > 0 ? accepted : n(input.meatKgFallback);
  if (kg <= 0) return null;
  return (birdsCost + n(input.directExpenses)) / kg;
}
