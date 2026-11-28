import { describe, expect, it } from "vitest";
import { extractNumbers, intToEgyptian, numberToEgyptian, toSpeechText } from "../../../supabase/functions/_shared/ar-speech-numbers";

describe("ar-speech-numbers (نطق الأرقام بالمصري)", () => {
  it.each([
    [0, "صفر"], [7, "سبعة"], [11, "حداشر"], [21, "واحد وعشرين"], [100, "مية"], [200, "ميتين"],
    [305, "تلتمية وخمسة"], [1000, "ألف"], [2000, "ألفين"], [3000, "تلات تلاف"], [10000, "عشر تلاف"],
    [11000, "حداشر ألف"], [12800, "اتناشر ألف وتمنمية"], [284330, "ميتين وأربعة وتمانين ألف وتلتمية وتلاتين"],
    [1229560, "مليون وميتين وتسعة وعشرين ألف وخمسمية وستين"], [2000000, "مليونين"], [3000000, "تلاتة مليون"],
  ])("intToEgyptian(%d)", (n, words) => {
    expect(intToEgyptian(n)).toBe(words);
  });

  it("decimals, negatives and separators", () => {
    expect(numberToEgyptian("4.3")).toBe("أربعة فاصلة تلاتة");
    expect(numberToEgyptian("-11.4")).toBe("سالب حداشر فاصلة أربعة");
    expect(numberToEgyptian("284,330")).toBe("ميتين وأربعة وتمانين ألف وتلتمية وتلاتين");
    expect(numberToEgyptian("0.9")).toBe("صفر فاصلة تسعة");
    expect(numberToEgyptian("4.05")).toBe("أربعة فاصلة صفر خمسة");
  });

  it("speech text: percentages, dates, Arabic digits, order numbers untouched", () => {
    expect(toSpeechText("الصرف 0.9% من المبيعات")).toBe("الصرف صفر فاصلة تسعة في المية من المبيعات");
    expect(toSpeechText("من 2026-10-18 لـ 2026-10-24")).toBe(
      "من تمنتاشر أكتوبر ألفين وستة وعشرين لـ أربعة وعشرين أكتوبر ألفين وستة وعشرين",
    );
    expect(toSpeechText("١٧٠ طلب")).toBe("مية وسبعين طلب");
    expect(toSpeechText("أقدمهم ORD-20260928-716702.")).toBe("أقدمهم ORD-20260928-716702.");
    expect(toSpeechText("صافي المبيعات 284,330 جنيه، و170 طلب.")).toBe(
      "صافي المبيعات ميتين وأربعة وتمانين ألف وتلتمية وتلاتين جنيه، ومية وسبعين طلب.",
    );
  });

  it("extractNumbers ignores dates and order numbers", () => {
    expect(extractNumbers("284,330 جنيه و170 طلب و0.9% من 2026-10-18، ORD-20260928-716702")).toEqual([284330, 170, 0.9]);
  });
});
