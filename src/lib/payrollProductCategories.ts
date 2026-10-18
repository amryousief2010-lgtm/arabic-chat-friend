// تصنيف أصناف قبض المسوقات. نفس الترتيب التاريخي:
// لحوم بالعظم أولًا، ثم المصنّعات، ثم اللحوم. لا تُغيّر الكلمات بدون طلب صريح.

export const MEAT_KEYWORDS = ['قطع', 'استيك', 'موزة', 'فراشة', 'قطعية', 'تربيانكو', 'اسكالوب', 'رول', 'كباب'];
export const BONE_MEAT_KEYWORDS = ['دبوس بالعظم', 'دبوس 6', 'فخده', 'فخذه', 'فخدة', 'نعامه صندوق', 'نعامة صندوق'];
export const PROCESSED_KEYWORDS = ['شاورما', 'شيش', 'كفته', 'كفتة', 'سجق', 'برجر', 'طرب', 'حواشي', 'حواشى', 'حواوشي', 'حواوشى', 'مفروم'];

export const normalizeProductName = (s: string) =>
  (s || '').replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');

export type PayrollProductCategory = 'meat' | 'bone' | 'processed' | null;

export const classifyPayrollProduct = (name: string): PayrollProductCategory => {
  const pname = normalizeProductName(name);
  if (BONE_MEAT_KEYWORDS.some((k) => pname.includes(normalizeProductName(k)))) return 'bone';
  if (PROCESSED_KEYWORDS.some((k) => pname.includes(normalizeProductName(k)))) return 'processed';
  if (MEAT_KEYWORDS.some((k) => pname.includes(normalizeProductName(k)))) return 'meat';
  return null;
};
