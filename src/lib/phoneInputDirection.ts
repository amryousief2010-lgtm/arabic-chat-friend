/** Direction for phone entry on an RTL page.
 * Digits are weak characters, so an inherited RTL field paints them from both
 * sides on mobile. A phone value is isolated LTR; an Arabic name stays RTL.
 * The stored string is never rewritten.
 */

const ARABIC_LETTERS =
  /[\u0600-\u065F\u066A-\u06EF\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const PHONE_CHARS = /[0-9+\u0660-\u0669\u06F0-\u06F9]/;

export type InputDirection = "ltr" | "rtl";

export function isPhoneLikeText(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (!text) return false;
  if (ARABIC_LETTERS.test(text)) return false;
  return PHONE_CHARS.test(text);
}

/** Search box: Arabic names stay RTL; phones, +20, and Arabic-Indic digits go LTR. */
export function customerSearchDirection(value: string | null | undefined): InputDirection {
  if (!value || !value.trim()) return "rtl";
  return isPhoneLikeText(value) ? "ltr" : "rtl";
}

export const PHONE_INPUT_STYLE = { unicodeBidi: "isolate" } as const;

export function phoneInputProps() {
  return {
    type: "tel" as const,
    inputMode: "tel" as const,
    autoComplete: "tel" as const,
    dir: "ltr" as const,
    style: PHONE_INPUT_STYLE,
    className: "text-left",
  };
}

export function customerSearchInputProps(value: string) {
  const dir = customerSearchDirection(value);
  return {
    dir,
    inputMode: (dir === "ltr" ? "tel" : "text") as "tel" | "text",
    autoComplete: "off" as const,
    style: PHONE_INPUT_STYLE,
    className: dir === "ltr" ? "text-left" : "",
  };
}

/** Logical insert used to assert caret and paste do not reverse digits. */
export function insertAtSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  inserted: string,
): { value: string; caret: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const next = value.slice(0, start) + inserted + value.slice(end);
  return { value: next, caret: start + inserted.length };
}
