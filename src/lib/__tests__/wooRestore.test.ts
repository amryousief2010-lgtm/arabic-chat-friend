import { describe, expect, it } from "vitest";
import { hideOnSitePayload, restoreChanges, restorePayload, showOnSitePayload, snapshotSha, stableJson } from "../../../supabase/functions/woo-catalog-sync/restore";

describe("woo restore helpers", () => {
  it("keeps only writable fields and image ids/src", () => {
    const snap = {
      id: 937,
      name: "استيك",
      regular_price: "800",
      price: "800",
      permalink: "https://x/p/937",
      date_created: "2026-01-01T00:00:00",
      images: [{ id: 1, src: "https://img/a.jpg", extra: "x" }],
      categories: [{ id: 9, name: "لحوم", slug: "meat" }],
    };
    const p = restorePayload(snap);
    expect(p.id).toBeUndefined();
    expect(p.permalink).toBeUndefined();
    expect(p.date_created).toBeUndefined();
    expect(p.price).toBeUndefined();
    expect(p.name).toBe("استيك");
    expect(p.regular_price).toBe("800");
    expect(p.images).toEqual([{ id: 1, src: "https://img/a.jpg" }]);
    expect(p.categories).toEqual([{ id: 9 }]);
  });

  it("diffs snapshot against current and hashes stably", async () => {
    const snap = { name: "أ", regular_price: "100", catalog_visibility: "visible", status: "publish" };
    const cur = { name: "أ", regular_price: "120", catalog_visibility: "hidden", status: "publish" };
    const ch = restoreChanges(cur, snap);
    const fields = ch.map((c) => c.field).sort();
    expect(fields).toEqual(["catalog_visibility", "regular_price"]);
    expect(stableJson({ b: 1, a: 2 })).toBe(stableJson({ a: 2, b: 1 }));
    const sha = await snapshotSha(snap);
    expect(sha).toHaveLength(64);
    expect(await snapshotSha({ a: 1, b: 2 })).toBe(await snapshotSha({ b: 2, a: 1 }));
  });

  it("hides reversibly by catalog_visibility and restores previous visibility", () => {
    expect(hideOnSitePayload()).toEqual({ status: "publish", catalog_visibility: "hidden" });
    expect(showOnSitePayload("visible")).toEqual({ status: "publish", catalog_visibility: "visible" });
    expect(showOnSitePayload(null)).toEqual({ status: "publish", catalog_visibility: "visible" });
    expect(showOnSitePayload("hidden")).toEqual({ status: "publish", catalog_visibility: "hidden" });
  });
});
