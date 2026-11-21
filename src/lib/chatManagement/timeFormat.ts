/** عرض الوقت بنظام 12 ساعة (ص/م) لوحدة إدارة المحادثات. العرض فقط، القيم المخزنة لا تتغير. */
const CAIRO = "Africa/Cairo";

const ampm = (h24: number, m: number): string => {
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${h24 < 12 ? "ص" : "م"}`;
};

/** تاريخ + وقت بتوقيت القاهرة، مثل «28/10/2026 9:07 م». */
export const formatDateTime12 = (t: string | Date | null | undefined): string => {
  if (!t) return "—";
  const d = new Date(t);
  if (isNaN(d.getTime())) return "—";
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: CAIRO, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${ampm(Number(p.hour) % 24, Number(p.minute))}`;
};

/** وقت من نص "HH:mm[:ss]" (مثل أوقات الشيفتات) إلى «9:00 م». */
export const formatClock12 = (hhmm: string | null | undefined): string => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return hhmm;
  return ampm(h, m);
};
