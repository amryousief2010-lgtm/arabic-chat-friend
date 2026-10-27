/**
 * هوية تصميم الموارد البشرية — ألوان الشعار فقط ومقياس النسبة الذهبية (1 : 1.618).
 * المرجع: الشعار = الوحدة الأساسية 16px، وكل درجة = السابقة × φ.
 */
export const PHI = 1.618;

export const BRAND = {
  magenta: "#A4288A",
  orange: "#F37346",
  purple: "#662D8C",
} as const;

/** تدرّج الشعار (بنفسجي ← ماجنتا ← برتقالي) */
export const BRAND_GRADIENT = `linear-gradient(135deg, ${BRAND.purple} 0%, ${BRAND.magenta} 55%, ${BRAND.orange} 100%)`;

/** درجة n من مقياس φ بالبكسل مقرّبة (n=0 → 16) */
export const phi = (n: number, base = 16) => Math.round(base * Math.pow(PHI, n));

/** المقياس المستخدم في الشاشات: 6, 10, 16, 26, 42, 68 */
export const SCALE = {
  xs: phi(-2), // 6
  sm: phi(-1), // 10
  md: phi(0), // 16
  lg: phi(1), // 26
  xl: phi(2), // 42
  xxl: phi(3), // 68
} as const;

/** لون شفاف من ألوان الشعار لخلفيات الشارات */
export const tint = (hex: string, alpha = 0.12) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** ثلاثة ألوان بالتناوب لأيقونات الأقسام */
export const BRAND_CYCLE = [BRAND.magenta, BRAND.purple, BRAND.orange] as const;
