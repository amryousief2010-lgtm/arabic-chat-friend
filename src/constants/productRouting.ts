export type ProductionDestination = "slaughterhouse" | "meat_factory" | "none";

/**
 * توجيه عجز المنتجات للقسم المسؤول.
 * كلمة «نعام/نعامة» وحدها لا تعني منتج مجزر: «برجر نعام» و«هوت دوج نعام» منتجات مصنّعة.
 * المجزر يأخذ الذبيحة والقطع بالعظم والمخرجات الخام (شغت، فرم، دهن، ريش) فقط.
 */
const SLAUGHTER_KEYWORDS = [
  "ذبيحة", "ذبيحه", "نعامة كاملة", "نعامه كامله", "نص نعامة", "نص نعامه", "نصف نعامة", "نصف نعامه",
  "صندوق", "بالعظم", "بالعضم", "فخدة", "فخده", "فخذة", "فخذه",
  "لحم نعام طازج", "لحم طازج",
  "شغت", "فرم", "دهن", "ريش",
];

const MEAT_FACTORY_KEYWORDS = [
  "كباب", "كفتة", "كفته", "برجر", "ستيك", "استيك", "شيش", "تربيانكو", "اسكالوب", "رول", "سجق",
  "موزة", "فراشة", "كبدة", "قلب", "قوانص", "رقاب", "كوارع", "قطعية", "دبوس",
  "بانيه", "نجتس", "ميت بول", "فيليه", "هوت دوج", "لانشون", "مدخن", "شاورما", "حواوشي", "مفروم",
];

const SKIP_KEYWORDS = ["بيض"]; // does not belong to either department

export const PROCESSED_MEAT_CATEGORY_NAME = "لحوم مصنعة";

const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
const hasAny = (n: string, words: string[]) => words.some((k) => n.includes(norm(k)));

export const classifyProductDestination = (name: string, category?: string | null): ProductionDestination => {
  const n = norm(name);
  if (hasAny(n, SKIP_KEYWORDS)) return "none";
  if (hasAny(n, SLAUGHTER_KEYWORDS)) return "slaughterhouse";
  if (norm(category || "") === norm(PROCESSED_MEAT_CATEGORY_NAME)) return "meat_factory";
  if (hasAny(n, MEAT_FACTORY_KEYWORDS)) return "meat_factory";
  // fallback: processed and unknown items go to the meat factory
  return "meat_factory";
};

export const destinationLabel = (d: ProductionDestination): string => ({
  slaughterhouse: "المجزر",
  meat_factory: "مصنع اللحوم",
  none: "غير محدد",
}[d]);
