// قائمة المحافظات المصرية الموحدة
// لكل محافظة: معرف ثابت (id) + اسم عربي معتمد (name) + أسماء بديلة (aliases)
// الأسماء البديلة تُستخدم فقط في مطابقة البيانات القديمة/المستوردة، ولا تُعرض للمستخدم.

export interface Governorate {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * تطبيع نص عربي لأغراض المطابقة فقط (لا يُحفظ في قاعدة البيانات):
 * - إزالة المسافات الزائدة والتطويل والتشكيل
 * - توحيد الألف والهمزة (أ إ آ ٱ → ا)
 * - توحيد الياء والألف المقصورة (ى → ي)
 * - توحيد التاء المربوطة والهاء (ة → ه)
 */
export function normalizeGovText(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/[\u0640\u064B-\u0652\u0670]/g, "") // تطويل + تشكيل
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ء/g, "")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "")
    .trim();
}

const g = (id: string, name: string, aliases: string[] = []): Governorate => ({ id, name, aliases });

export const EGYPT_GOVERNORATES: Governorate[] = [
  g("cairo", "القاهرة", ["قاهرة", "القاهره", "مصر الجديدة", "cairo"]),
  g("giza", "الجيزة", ["جيزة", "الجيزه", "جيزه", "الجبزه", "giza"]),
  g("alexandria", "الإسكندرية", [
    "اسكندرية", "الاسكندرية", "الإسكندرية", "اسكندريه", "الاسكندريه",
    "الإسكندريه", "الأسكندرية", "الأسكندريه", "الاسكندربه", "اسكندرية مصر", "alexandria",
  ]),
  g("qalyubia", "القليوبية", ["قليوبية", "القليوبيه", "قليوبيه"]),
  g("dakahlia", "الدقهلية", ["دقهلية", "الدقهليه", "دقهليه"]),
  g("gharbia", "الغربية", ["غربية", "الغربيه", "غربيه", "الغرييه"]),
  g("menoufia", "المنوفية", ["منوفية", "المنوفيه", "منوفيه"]),
  g("sharqia", "الشرقية", ["شرقية", "الشرقيه", "شرقيه"]),
  g("beheira", "البحيرة", ["بحيرة", "البحيره", "بحيره"]),
  g("kafr_elsheikh", "كفر الشيخ", ["كفرالشيخ", "كفر الشيخ"]),
  g("damietta", "دمياط", ["دمياط"]),
  g("portsaid", "بورسعيد", ["بور سعيد"]),
  g("ismailia", "الإسماعيلية", ["الاسماعيلية", "الاسماعيليه", "الإسماعيليه", "اسماعيلية", "اسماعيليه", "الاسماعليه"]),
  g("suez", "السويس", ["سويس"]),
  g("northsinai", "شمال سيناء", ["شمال سينا"]),
  g("southsinai", "جنوب سيناء", ["جنوب سينا", "شرم الشيخ", "دهب"]),
  g("matrouh", "مطروح", ["مرسى مطروح", "مرسي مطروح"]),
  g("redsea", "البحر الأحمر", ["البحر الاحمر", "الغردقة", "الغردقه", "الغردقة البحر الاحمر"]),
  g("fayoum", "الفيوم", ["فيوم"]),
  g("banisuef", "بني سويف", ["بنى سويف", "بنيسويف"]),
  g("minya", "المنيا", ["منيا"]),
  g("assiut", "أسيوط", ["اسيوط"]),
  g("sohag", "سوهاج", ["سوهاچ"]),
  g("qena", "قنا", ["قنا"]),
  g("luxor", "الأقصر", ["الاقصر", "اقصر"]),
  g("aswan", "أسوان", ["اسوان"]),
  g("newvalley", "الوادي الجديد", ["الوادى الجديد", "الخارجة", "الخارجه"]),
];

// خريطة: النص المطبّع → المحافظة المعتمدة
const LOOKUP: Record<string, Governorate> = (() => {
  const map: Record<string, Governorate> = {};
  for (const gov of EGYPT_GOVERNORATES) {
    const keys = [gov.name, ...gov.aliases];
    for (const k of keys) {
      const n = normalizeGovText(k);
      if (n && !map[n]) map[n] = gov;
    }
    // صيغة بدون "ال" التعريف
    const bare = normalizeGovText(gov.name).replace(/^ال/, "");
    if (bare && !map[bare]) map[bare] = gov;
  }
  return map;
})();

/** إرجاع المحافظة المعتمدة المطابقة لنص خام، أو null إذا لم تُعرف. */
export function resolveGovernorate(raw?: string | null): Governorate | null {
  const n = normalizeGovText(raw);
  if (!n) return null;
  return LOOKUP[n] ?? null;
}

/** معرف المحافظة الموحد المستخدم في الفلاتر (أو "other:<نص مطبّع>" للقيم غير المعروفة). */
export function governorateId(raw?: string | null): string | null {
  const n = normalizeGovText(raw);
  if (!n) return null;
  const gov = LOOKUP[n];
  return gov ? gov.id : `other:${n}`;
}

/** الاسم المعروض المعتمد لأي قيمة خام. */
export function governorateLabel(raw?: string | null): string {
  const gov = resolveGovernorate(raw);
  if (gov) return gov.name;
  return (raw || "").trim();
}

export const GOVERNORATE_NAMES = EGYPT_GOVERNORATES.map((x) => x.name);
