export type ProductionDestination = "slaughterhouse" | "meat_factory" | "none";

// Keywords (Arabic) used to auto-route a product to the right department.
const SLAUGHTER_KEYWORDS = [
  "نعامة", "نعام", "فخدة", "نص نعامة", "ذبيحة", "كاملة", "صندوق", "لحم نعام طازج", "لحم طازج",
];

const MEAT_FACTORY_KEYWORDS = [
  "كباب", "كفتة", "برجر", "ستيك", "استيك", "شيش", "تربيانكو", "اسكالوب", "رول", "سجق",
  "موزة", "فراشة", "كبدة", "قلب", "قوانص", "رقاب", "كوارع", "دهن", "قطعية", "دبوس",
  "بانيه", "نجتس", "ميت بول", "فيليه",
];

const SKIP_KEYWORDS = ["بيض"]; // does not belong to either department

export const classifyProductDestination = (name: string): ProductionDestination => {
  const n = (name || "").toLowerCase();
  if (SKIP_KEYWORDS.some(k => n.includes(k.toLowerCase()))) return "none";
  if (SLAUGHTER_KEYWORDS.some(k => n.includes(k.toLowerCase()))) return "slaughterhouse";
  if (MEAT_FACTORY_KEYWORDS.some(k => n.includes(k.toLowerCase()))) return "meat_factory";
  // fallback: full birds usually go through slaughter, processed cuts through factory
  return "meat_factory";
};

export const destinationLabel = (d: ProductionDestination): string => ({
  slaughterhouse: "المجزر",
  meat_factory: "مصنع اللحوم",
  none: "غير محدد",
}[d]);
