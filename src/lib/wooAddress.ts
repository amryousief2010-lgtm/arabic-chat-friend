/**
 * تقسيم عنوان الموقع (WooCommerce) إلى حقول العميل في COCEG: المحافظة / المدينة / المنطقة / العنوان.
 * لا يُخمَّن شيء غير موجود في بيانات الموقع: المحافظة من رمز الولاية (مثل EGC)، والمدينة والمنطقة
 * من حقول الموقع أو من أسماء معروفة مكتوبة في العنوان نفسه، والباقي يبقى في «العنوان». كل الحقول
 * قابلة للتعديل قبل الإسناد.
 */
import { EGYPT_GOVERNORATES, resolveGovernorate } from "@/lib/governorates";

/** رموز محافظات مصر في WooCommerce (states EG) → معرف المحافظة في القائمة الموحدة. */
export const WOO_EG_STATE_TO_GOV_ID: Record<string, string> = {
  EGALX: "alexandria", EGASN: "aswan", EGAST: "assiut", EGBA: "redsea", EGBH: "beheira",
  EGBNS: "banisuef", EGC: "cairo", EGDK: "dakahlia", EGDT: "damietta", EGFYM: "fayoum",
  EGGH: "gharbia", EGGZ: "giza", EGIS: "ismailia", EGJS: "southsinai", EGKB: "qalyubia",
  EGKFS: "kafr_elsheikh", EGKN: "qena", EGLX: "luxor", EGMN: "minya", EGMNF: "menoufia",
  EGMT: "matrouh", EGPTS: "portsaid", EGSHG: "sohag", EGSHR: "sharqia", EGSIN: "northsinai",
  EGSUZ: "suez", EGWAD: "newvalley",
};

/** اسم المحافظة المعتمد من رمز الموقع أو من نص المحافظة؛ «» إن تعذّر. */
export function governorateFromWoo(state: string | null | undefined): string {
  const s = String(state ?? "").trim();
  if (!s) return "";
  const id = WOO_EG_STATE_TO_GOV_ID[s.toUpperCase()];
  if (id) return EGYPT_GOVERNORATES.find((g) => g.id === id)?.name ?? "";
  return resolveGovernorate(s)?.name ?? "";
}

/** تطبيع للمطابقة مع الإبقاء على المسافات بين الكلمات. */
export function normAr(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/[\u0640\u064B-\u0652\u0670]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[،,.\-–|/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** مدن ومناطق شائعة (الاسم المعتمد + صيغ مكتوبة). المدينة تُكتب في حقل «المدينة»، والمنطقة في «المنطقة». */
const CITIES: { name: string; gov: string; alts: string[] }[] = [
  { name: "القاهرة الجديدة", gov: "القاهرة", alts: ["القاهرة الجديدة", "القاهره الجديده", "new cairo"] },
  { name: "مدينة نصر", gov: "القاهرة", alts: ["مدينة نصر", "مدينه نصر", "nasr city"] },
  { name: "مصر الجديدة", gov: "القاهرة", alts: ["مصر الجديدة", "مصر الجديده", "heliopolis"] },
  { name: "الشروق", gov: "القاهرة", alts: ["مدينة الشروق", "الشروق"] },
  { name: "بدر", gov: "القاهرة", alts: ["مدينة بدر"] },
  { name: "العبور", gov: "القليوبية", alts: ["مدينة العبور", "العبور"] },
  { name: "المعادي", gov: "القاهرة", alts: ["المعادي", "المعادى", "maadi"] },
  { name: "حلوان", gov: "القاهرة", alts: ["حلوان"] },
  { name: "المقطم", gov: "القاهرة", alts: ["المقطم"] },
  { name: "6 أكتوبر", gov: "الجيزة", alts: ["6 اكتوبر", "السادس من اكتوبر", "٦ اكتوبر", "اكتوبر", "october"] },
  { name: "الشيخ زايد", gov: "الجيزة", alts: ["الشيخ زايد", "زايد", "sheikh zayed"] },
  { name: "حدائق الأهرام", gov: "الجيزة", alts: ["حدائق الاهرام"] },
];

const AREAS: { name: string; alts: string[] }[] = [
  { name: "التجمع الأول", alts: ["التجمع الاول"] },
  { name: "التجمع الثالث", alts: ["التجمع الثالث"] },
  { name: "التجمع الخامس", alts: ["التجمع الخامس"] },
  { name: "الرحاب", alts: ["الرحاب", "مدينة الرحاب"] },
  { name: "مدينتي", alts: ["مدينتي", "مدينتى"] },
];

const findPhrase = <T extends { alts: string[] }>(list: T[], text: string): { item: T; alt: string } | null => {
  const t = ` ${normAr(text)} `;
  let best: { item: T; alt: string } | null = null;
  for (const item of list)
    for (const alt of item.alts) {
      const a = normAr(alt);
      if (a && t.includes(` ${a} `) && (!best || a.length > normAr(best.alt).length)) best = { item, alt };
    }
  return best;
};

/** يحذف عبارة معروفة من نهاية العنوان فقط (لا يلمس منتصفه). */
function stripTrailing(address: string, phrases: string[]): string {
  let words = address.trim().split(/\s+/);
  let changed = true;
  while (changed && words.length) {
    changed = false;
    for (const p of phrases) {
      const pw = normAr(p).split(" ").filter(Boolean);
      if (!pw.length || pw.length >= words.length) continue;
      const tail = normAr(words.slice(-pw.length).join(" "));
      if (tail === pw.join(" ")) {
        words = words.slice(0, -pw.length);
        changed = true;
      }
    }
  }
  return words.join(" ").replace(/[\s،,\-–]+$/, "").trim();
}

export interface WooAddressInput {
  address_1?: string | null;
  address_2?: string | null;
  address?: string | null; // العنوان المجمّع (سجلات قديمة)
  city?: string | null;
  state?: string | null;
}

export interface SplitAddress {
  governorate: string;
  city: string;
  area: string;
  address: string;
}

export function splitWooAddress(input: WooAddressInput): SplitAddress {
  const governorate = governorateFromWoo(input.state);
  const a1 = String(input.address_1 ?? "").trim();
  const a2 = String(input.address_2 ?? "").trim();
  const full = a1 || a2 ? [a1, a2].filter(Boolean).join(" ") : String(input.address ?? "").trim();
  const wooCity = String(input.city ?? "").trim();
  const cityIsGov = !wooCity || (!!governorate && normAr(resolveGovernorate(wooCity)?.name) === normAr(governorate));

  const cityHit = findPhrase(CITIES, full) ?? (wooCity ? findPhrase(CITIES, wooCity) : null);
  const city = cityHit ? cityHit.item.name : cityIsGov ? "" : wooCity;
  const areaHit = findPhrase(AREAS, a2 || full);
  const area = a2 && !areaHit ? a2 : areaHit ? areaHit.item.name : "";

  const street = stripTrailing(a1 || full, [
    ...(areaHit ? [areaHit.alt, areaHit.item.name] : []),
    ...(cityHit ? [cityHit.alt, cityHit.item.name] : []),
    ...(wooCity ? [wooCity] : []),
    ...(governorate ? [governorate, ...(EGYPT_GOVERNORATES.find((g) => g.name === governorate)?.aliases ?? [])] : []),
  ]);
  return { governorate, city, area, address: street || full };
}

/** طرق التسليم كما في شاشة الطلبات (تعديل طريقة التسليم والعنوان). */
export const FULFILLMENT_OPTIONS: { key: string; label: string }[] = [
  { key: "pickup_main", label: "استلام من المخزن الرئيسي" },
  { key: "delivery_main", label: "توصيل بالمندوب الخاص (كيمو)" },
  { key: "pickup_agouza", label: "استلام من مخزن العجوزة" },
  { key: "delivery_agouza", label: "توصيل من منفذ العجوزة" },
  { key: "shipping_company", label: "شركة شحن" },
];

/** عنوان التوصيل على الطلب: العنوان ثم المنطقة ثم المدينة ثم المحافظة (بدون تكرار). */
export function deliveryAddressLine(a: SplitAddress): string {
  const parts: string[] = [];
  for (const p of [a.address, a.area, a.city, a.governorate]) {
    const v = p.trim();
    if (v && !parts.some((x) => normAr(x) === normAr(v))) parts.push(v);
  }
  return parts.join("، ");
}
