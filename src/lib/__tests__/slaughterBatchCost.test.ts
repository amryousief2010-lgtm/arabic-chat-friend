import { describe, expect, it } from "vitest";
import {
  allocateSlaughterBatch,
  costPerKgFromSnapshots,
  SlaughterAllocationError,
  type SlaughterReceiptCost,
} from "@/lib/slaughterBatchCost";

const zeros = {
  openingCost: 0,
  feedCost: 0,
  mortalityCost: 0,
  otherCost: 0,
  birdFeedCost: 0,
  deadOnArrival: 0,
  mortalityCount: 0,
  manualAdjustment: 0,
};

/** اسفنكس — 17 Oct 2026. Price is per live kg, stored as one receipt total. */
const asfunks: SlaughterReceiptCost = {
  id: "asfunks",
  birdCount: 5,
  totalWeightKg: 587,
  totalCost: 61499.99,
  ...zeros,
};

/** زفتى — same day. */
const zifta: SlaughterReceiptCost = {
  id: "zifta",
  birdCount: 5,
  totalWeightKg: 466,
  totalCost: 47299.932,
  ...zeros,
};

describe("slaughter batch cost share", () => {
  it("splits one receipt across two batches by the birds each batch actually slaughters", () => {
    const first = allocateSlaughterBatch({
      receipts: [asfunks],
      sources: [{ receiptId: "asfunks", birds: 4 }],
      outputs: [{ actualWeightKg: 207.5 }],
    });
    const second = allocateSlaughterBatch({
      receipts: [asfunks],
      sources: [{ receiptId: "asfunks", birds: 1 }],
      priorUses: first.sources,
      outputs: [{ actualWeightKg: 80 }],
    });

    expect(first.sources[0].basis).toBe("bird");
    expect(first.sources[0].cost).toBeCloseTo(49199.992, 3);
    expect(first.costPerKg).toBeCloseTo(237.1084, 3);
    expect(first.totalCost).not.toBeCloseTo(61499.99, 0);

    expect(second.sources[0].cost).toBeCloseTo(12299.998, 3);
    expect(second.totalCost).not.toBeCloseTo(61499.99, 0);
    expect(first.birdsCost + second.birdsCost).toBeCloseTo(61499.99, 2);
  });

  it("charges a batch that draws two receipts only for each receipt's share", () => {
    // SB-20261017-6422: 1 bird from اسفنكس and 2 birds from زفتى, 112.5 kg meat.
    const batch = allocateSlaughterBatch({
      receipts: [asfunks, zifta],
      sources: [
        { receiptId: "asfunks", birds: 1 },
        { receiptId: "zifta", birds: 2 },
      ],
      outputs: [{ actualWeightKg: 112.5 }],
    });

    expect(batch.sources[0].cost).toBeCloseTo(12299.998, 3);
    expect(batch.sources[1].cost).toBeCloseTo(18919.9728, 3);
    expect(batch.birdsCost).toBeCloseTo(31219.9708, 3);
    expect(batch.costPerKg).toBeCloseTo(277.51085, 3);
    expect(batch.totalCost).toBeLessThan(61499.99);
    expect(batch.totalCost).toBeLessThan(47299.932);
  });

  it("charges the whole receipt when one batch slaughters every bird", () => {
    const batch = allocateSlaughterBatch({
      receipts: [zifta],
      sources: [{ receiptId: "zifta", birds: 5 }],
      outputs: [{ actualWeightKg: 200 }],
      directExpenses: 500,
    });

    expect(batch.birdsCost).toBeCloseTo(47299.932, 3);
    expect(batch.totalCost).toBeCloseTo(47799.932, 3);
    expect(batch.costPerKg).toBeCloseTo(47799.932 / 200, 4);
  });

  it("refuses to allocate more birds, weight, or cost than the receipt still has", () => {
    const first = allocateSlaughterBatch({
      receipts: [asfunks],
      sources: [{ receiptId: "asfunks", birds: 4 }],
      outputs: [{ actualWeightKg: 207.5 }],
    });

    expect(() =>
      allocateSlaughterBatch({
        receipts: [asfunks],
        sources: [{ receiptId: "asfunks", birds: 2 }],
        priorUses: first.sources,
      }),
    ).toThrow(SlaughterAllocationError);

    const weighed = allocateSlaughterBatch({
      receipts: [{ id: "w", birdCount: 10, totalWeightKg: 100, totalCost: 1000, ...zeros }],
      sources: [{ receiptId: "w", birds: 2, liveWeightKg: 80 }],
    });
    expect(weighed.sources[0].basis).toBe("live_weight");
    expect(weighed.sources[0].cost).toBeCloseTo(800, 4);

    expect(() =>
      allocateSlaughterBatch({
        receipts: [{ id: "w", birdCount: 10, totalWeightKg: 100, totalCost: 1000, ...zeros }],
        sources: [{ receiptId: "w", birds: 2, liveWeightKg: 30 }],
        priorUses: weighed.sources,
      }),
    ).toThrow(expect.objectContaining({ code: "weight" }));

    expect(() =>
      allocateSlaughterBatch({
        receipts: [{ id: "w", birdCount: 10, totalWeightKg: 100, totalCost: 1000, ...zeros }],
        sources: [{ receiptId: "w", birds: 3 }],
        priorUses: weighed.sources,
      }),
    ).toThrow(expect.objectContaining({ code: "cost" }));
  });

  it("spreads the batch cost across accepted output kilograms and ignores waste", () => {
    const batch = allocateSlaughterBatch({
      receipts: [{ id: "r", birdCount: 2, totalWeightKg: 100, totalCost: 1000, ...zeros }],
      sources: [{ receiptId: "r", birds: 2 }],
      outputs: [
        { actualWeightKg: 30, destination: "warehouse" },
        { actualWeightKg: 10, damagedKg: 10, destination: "warehouse" },
        { actualWeightKg: 5, destination: "waste" },
      ],
    });
    expect(batch.acceptedKg).toBe(30);
    expect(batch.costPerKg).toBeCloseTo(1000 / 30, 4);
  });

  it("reproduces the 17 Oct batches from locked source snapshots", () => {
    const sb7650 = costPerKgFromSnapshots({
      sources: [{ totalBirdsCost: 49199.992, birds: 4 }],
      outputs: [{ actualWeightKg: 207.5 }],
    });
    const sb6422 = costPerKgFromSnapshots({
      sources: [{ totalBirdsCost: 12299.998 }, { totalBirdsCost: 18919.9728 }],
      outputs: [{ actualWeightKg: 112.5 }],
    });
    expect(sb7650).toBeCloseTo(237.1084, 3);
    expect(sb6422).toBeCloseTo(277.51085, 3);
    // The bug charged each batch the full اسفنكس receipt.
    expect(61499.99 / 207.5).toBeCloseTo(296.3855, 3);
    expect(61499.99 / 112.5).toBeCloseTo(546.6666, 3);
  });
});
