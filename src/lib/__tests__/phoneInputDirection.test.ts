import { describe, expect, it } from "vitest";
import {
  customerSearchDirection,
  insertAtSelection,
  isPhoneLikeText,
} from "../phoneInputDirection";

describe("customer search direction", () => {
  it("keeps an empty box and Arabic names RTL", () => {
    expect(customerSearchDirection("")).toBe("rtl");
    expect(customerSearchDirection("   ")).toBe("rtl");
    expect(customerSearchDirection("أحمد")).toBe("rtl");
    expect(customerSearchDirection("محمد علي")).toBe("rtl");
    expect(isPhoneLikeText("أحمد")).toBe(false);
  });

  it("treats Latin digits, Arabic-Indic digits, and +20 as LTR phones", () => {
    expect(customerSearchDirection("010")).toBe("ltr");
    expect(customerSearchDirection("٠١٠١٢٣٤٥٦٧٨")).toBe("ltr");
    expect(customerSearchDirection("+20 10 0123")).toBe("ltr");
    expect(customerSearchDirection("+201012345678")).toBe("ltr");
    expect(isPhoneLikeText("۰۱۰")).toBe(true);
  });
});

describe("phone typing does not reverse stored digits", () => {
  it("inserts typed digits at the caret in logical order", () => {
    let value = "";
    let caret = 0;
    for (const digit of "010") {
      const next = insertAtSelection(value, caret, caret, digit);
      value = next.value;
      caret = next.caret;
    }
    expect(value).toBe("010");
    expect(caret).toBe(3);

    const mid = insertAtSelection(value, 1, 1, "9");
    expect(mid).toEqual({ value: "0910", caret: 2 });
  });

  it("replaces a selection and pastes +20 or Arabic digits without flipping them", () => {
    expect(insertAtSelection("01077770001", 0, 11, "+20")).toEqual({
      value: "+20",
      caret: 3,
    });
    expect(insertAtSelection("", 0, 0, "+20 10")).toEqual({
      value: "+20 10",
      caret: 6,
    });
    expect(insertAtSelection("01", 2, 2, "٠١٢")).toEqual({
      value: "01٠١٢",
      caret: 5,
    });
    const selected = insertAtSelection("01077770001", 3, 7, "1234");
    expect(selected.value).toBe("01012340001");
    expect(selected.caret).toBe(7);
  });
});
