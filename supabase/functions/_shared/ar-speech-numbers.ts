// تحويل الأرقام في النص لكلام مصري مقروء عشان صوت المساعد ينطقها صح.
// الشاشة بتعرض الأرقام اللاتينية زي ما هي؛ ده للنطق بس. دالة نقية (من غير Deno APIs) عشان تتختبر بـ vitest.

const ONES = [
  "صفر", "واحد", "اتنين", "تلاتة", "أربعة", "خمسة", "ستة", "سبعة", "تمانية", "تسعة", "عشرة",
  "حداشر", "اتناشر", "تلتاشر", "أربعتاشر", "خمستاشر", "ستاشر", "سبعتاشر", "تمنتاشر", "تسعتاشر",
];
const TENS = ["", "", "عشرين", "تلاتين", "أربعين", "خمسين", "ستين", "سبعين", "تمانين", "تسعين"];
const HUNDREDS = ["", "مية", "ميتين", "تلتمية", "ربعمية", "خمسمية", "ستمية", "سبعمية", "تمنمية", "تسعمية"];
// العدد قبل «تلاف» (3 إلى 10): تلات تلاف، أربع تلاف...
const THOUSANDS_FEW = ["", "", "", "تلات", "أربع", "خمس", "ست", "سبع", "تمن", "تسع", "عشر"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10), o = n % 10;
  return o ? `${ONES[o]} و${TENS[t]}` : TENS[t];
}

function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) parts.push(below100(r));
  return parts.join(" و");
}

function scale(k: number, one: string, two: string, few: (k: number) => string, many: string): string {
  if (k === 1) return one;
  if (k === 2) return two;
  if (k >= 3 && k <= 10) return few(k);
  return `${below1000(k)} ${many}`;
}

/** عدد صحيح موجب أو صفر (لحد 999 مليار) لكلام مصري. */
export function intToEgyptian(n: number): string {
  if (!Number.isFinite(n)) return "";
  n = Math.floor(Math.abs(n));
  if (n === 0) return ONES[0];
  if (n >= 1e12) return String(n);
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1e3);
  const rest = n % 1e3;
  const parts: string[] = [];
  if (billions) parts.push(scale(billions, "مليار", "مليارين", (k) => `${ONES[k]} مليار`, "مليار"));
  if (millions) parts.push(scale(millions, "مليون", "مليونين", (k) => `${ONES[k]} مليون`, "مليون"));
  if (thousands) parts.push(scale(thousands, "ألف", "ألفين", (k) => `${THOUSANDS_FEW[k]} تلاف`, "ألف"));
  if (rest) parts.push(below1000(rest));
  return parts.join(" و");
}

/** رقم نصي زي "284,330" أو "4.3" أو "-11.4" لكلام. */
export function numberToEgyptian(raw: string): string {
  let s = raw.replace(/[,٬\s]/g, "");
  let neg = false;
  if (s.startsWith("-") || s.startsWith("−")) { neg = true; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  const [i, f] = s.split(".");
  let out = intToEgyptian(Number(i || "0"));
  const frac = (f || "").replace(/0+$/, "");
  if (frac) {
    // الكسور القصيرة بتتقري كرقم: 4.25 → أربعة فاصلة خمسة وعشرين، 4.05 → أربعة فاصلة صفر خمسة
    const lead = frac.match(/^0+/)?.[0].length ?? 0;
    out += " فاصلة " + [...Array(lead)].map(() => ONES[0]).concat(Number(frac) ? [intToEgyptian(Number(frac))] : []).join(" ");
  }
  return (neg ? "سالب " : "") + out;
}

export function toLatinDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".");
}

/** نص العرض (أرقام لاتينية) → نص للنطق (أرقام بالكلام المصري). */
export function toSpeechText(display: string): string {
  let s = toLatinDigits(display);
  // تواريخ ISO: 2026-10-18 → 18 أكتوبر 2026
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => `${Number(d)} ${MONTHS[Number(mo) - 1] ?? mo} ${y}`);
  // أرقام مربوطة بحروف لاتينية أو شرطة (أرقام طلبات مثلًا) بتتساب زي ما هي
  s = s.replace(/(^|[^\w\-.,])([-−+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−+]?\d+(?:\.\d+)?)(\s?%)?(?![\w\-]|[.,]\d)/g,
    (_m, pre: string, num: string, pct: string | undefined) => `${pre}${numberToEgyptian(num)}${pct ? " في المية" : ""}`);
  return s
    .replace(/EGP|ج\.م\.?/g, "جنيه")
    .replace(/[*_#`>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** الأرقام اللي في نص العرض (للتحقق إنها جاية من نتائج الأدوات). */
export function extractNumbers(display: string): number[] {
  const s = toLatinDigits(display).replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  const out: number[] = [];
  for (const m of s.matchAll(/(?<![\w\-])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w\-.,])\d+(?:\.\d+)?(?![\w\-])/g)) {
    out.push(Number(m[0].replace(/,/g, "")));
  }
  return out;
}
