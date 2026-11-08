import { describe, expect, it } from "vitest";
import {
  composePhoneValue,
  currentReviewMonth,
  needsDropConfirmation,
  pageCount,
  pageRangeLabel,
  phoneSaveErrorCode,
  phoneSaveErrorMessage,
  reviewLoadState,
  reviewMonthOptions,
  visiblePhoneParts,
} from "../phoneReview";

describe("phone review filters", () => {
  it("defaults to the current Cairo month and offers every month plus all months", () => {
    const now = new Date("2026-11-08T22:30:00Z");
    expect(currentReviewMonth(now)).toBe("2026-11-01");
    const options = reviewMonthOptions(now, 3);
    expect(options[0]).toEqual({ value: "all", label: "كل الشهور" });
    expect(options.map((option) => option.value)).toEqual([
      "all",
      "2026-11-01",
      "2026-10-01",
      "2026-09-01",
    ]);
  });

  it("distinguishes loading, error, and no matches", () => {
    expect(reviewLoadState(true, false, 0)).toBe("loading");
    expect(reviewLoadState(false, true, 0)).toBe("error");
    expect(reviewLoadState(false, false, 0)).toBe("empty");
    expect(reviewLoadState(false, false, 12)).toBe("ready");
  });

  it("pages with an accurate range and does not pretend a short page is the whole queue", () => {
    expect(pageCount(4510, 25)).toBe(181);
    expect(pageRangeLabel(2, 25, 4510)).toBe("عرض 26–50 من 4510");
    expect(pageRangeLabel(1, 25, 0)).toBe("لا توجد حالات مطابقة");
  });
});

describe("phone correction", () => {
  it("keeps both numbers in one field and asks before a number is dropped", () => {
    expect(visiblePhoneParts("01077770002 / 01077770003")).toEqual(["01077770002", "01077770003"]);
    expect(composePhoneValue(["01077770002", "01077770003"])).toBe("01077770002 / 01077770003");
    expect(needsDropConfirmation(2, ["01077770002", "01077770003"])).toBe(false);
    expect(needsDropConfirmation(2, ["01077770002", ""])).toBe(true);
    expect(needsDropConfirmation(1, ["01077770002"])).toBe(false);
  });

  it("maps save failures to Arabic without repeating the database text", () => {
    expect(phoneSaveErrorCode("CM_PHONE_DROP_CONFIRM")).toBe("CM_PHONE_DROP_CONFIRM");
    expect(phoneSaveErrorMessage("CM_PHONE_INVALID")).toBe("كل رقم يجب أن يكون موبايلًا مصريًا صحيحًا");
    expect(phoneSaveErrorMessage("value 01077770999 violates check")).toBe("تعذّر حفظ الرقم");
    expect(phoneSaveErrorMessage("CM_PHONE_INVALID")).not.toMatch(/010/);
  });
});
