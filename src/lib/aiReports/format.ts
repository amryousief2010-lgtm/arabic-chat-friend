/** أرقام لاتينية دايمًا (قاعدة م. عمرو)، بدل الأرقام الهندية اللي كان بيرجّعها "ar-EG". */
export const LOCALE = "ar-EG-u-nu-latn";
export const egp = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(Number(n)).toLocaleString(LOCALE)} جنيه`;
export const num = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : Number(n).toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
export const pct = (n: number | null | undefined, digits = 1) => (n == null ? "—" : `${num(n, digits)}%`);
export const ratio = (a: number, b: number) => (b > 0 ? (a * 100) / b : null);
/** وقت بتوقيت الرياض للعرض. */
export const riyadhTime = (iso: string) =>
  new Date(iso).toLocaleString(LOCALE, { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" });
export const arDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" });
