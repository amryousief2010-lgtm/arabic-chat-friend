// Configuration for the 4 sales moderator girls.
// `aliases` are matched (after Arabic normalization) against either the
// `orders.moderator` text or the creator's profile full_name, so historical
// data with different spellings still attributes correctly.

export interface ModeratorConfig {
  slug: string;
  displayName: string;
  // The canonical name to write into `orders.moderator` for NEW orders
  // created by this user. Keep matching how historical rows look.
  canonicalModerator: string;
  // المفتاح المستخدم في جداول القبض/الكميات (بيانات تاريخية محفوظة بهذا الاسم).
  payrollKey: string;
  // تاريخ بداية العمل (YYYY-MM-DD). لا تُحسب لها تارجت/بونص/قبض قبل هذا الشهر.
  startDate?: string;
  baseSalary: number;
  aliases: string[];
  gradient: string; // tailwind gradient classes for the card
  iconBg: string;
}

export const MODERATORS: ModeratorConfig[] = [
  {
    slug: "aya",
    displayName: "آية",
    canonicalModerator: "أية",
    payrollKey: "اية",
    baseSalary: 3000,
    aliases: ["اية", "آية", "أية", "ايه", "آيه", "أيه"],
    gradient: "from-primary to-primary/70",
    iconBg: "bg-primary",
  },
  {
    slug: "noura",
    displayName: "نورا",
    canonicalModerator: "نورا",
    payrollKey: "نورا",
    baseSalary: 2500,
    aliases: ["نورا", "نوره", "نورة"],
    gradient: "from-secondary to-secondary/70",
    iconBg: "bg-secondary",
  },
  {
    slug: "manal",
    // منال تركت الشركة وهاجر تشتغل مكانها على نفس الحساب.
    // الأوردرات الجديدة تتسجل باسم "هاجر"، والأوردرات التاريخية باسم "منال"
    // تفضل مرتبطة بنفس الخانة عن طريق aliases + matchesModeratorGroup.
    displayName: "هاجر",
    canonicalModerator: "هاجر",
    payrollKey: "منال",
    baseSalary: 2500,
    aliases: ["منال", "هاجر"],
    gradient: "from-chart-4 to-chart-4/70",
    iconBg: "bg-chart-4",
  },
  {
    slug: "mariam",
    displayName: "مريم",
    canonicalModerator: "مريم",
    payrollKey: "مريم",
    // بداية العمل الرسمية — لا قبض/تارجت/بونص عن أي شهر قبلها.
    startDate: "2026-09-01",
    baseSalary: 2500,
    aliases: ["مريم", "مريام"],
    gradient: "from-chart-2 to-chart-2/70",
    iconBg: "bg-chart-2",
  },
];

// هل المسوقة كانت على رأس العمل خلال شهر معيّن؟ (month = 1..12)
export const isModeratorActiveInMonth = (
  m: ModeratorConfig,
  year: number,
  month: number,
): boolean => {
  if (!m.startDate) return true;
  const [sy, sm] = m.startDate.split("-").map(Number);
  return year > sy || (year === sy && month >= sm);
};

// قائمة المسوقات الفعّالة في شهر معيّن (تُستخدم في التارجت/القبض/البونص/الإحصائيات).
export const moderatorsForMonth = (year: number, month: number): ModeratorConfig[] =>
  MODERATORS.filter((m) => isModeratorActiveInMonth(m, year, month));

// مفاتيح القبض/الكميات للمسوقات الفعّالة في شهر معيّن.
export const moderatorKeysForMonth = (year: number, month: number): string[] =>
  moderatorsForMonth(year, month).map((m) => m.payrollKey);

export const ALL_MODERATOR_KEYS: string[] = MODERATORS.map((m) => m.payrollKey);

export const baseSalaryForKey = (key: string): number =>
  MODERATORS.find((m) => m.payrollKey === key)?.baseSalary ?? 2500;


// اسم العرض للمسوقة استناداً إلى القيمة المخزّنة في orders.moderator أو مفاتيح التجميع.
// تُستخدم لعرض "هاجر" بدلاً من "منال" في الواجهات، مع الحفاظ على مفاتيح البيانات كما هي.
export const displayModeratorName = (name: string): string =>
  name === "منال" ? "هاجر" : name;


// Normalize Arabic for fuzzy comparison.
export const normalizeAr = (s: string): string =>
  (s || "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

export const findModeratorBySlug = (slug?: string): ModeratorConfig | undefined =>
  MODERATORS.find((m) => m.slug === slug);

// Returns the moderator that matches a given name (from order.moderator
// text or a profile full_name). Used both to attribute existing orders
// and to auto-detect the logged-in girl from her profile.
export const findModeratorByName = (name?: string | null): ModeratorConfig | undefined => {
  if (!name) return undefined;
  const n = normalizeAr(name);
  return MODERATORS.find((m) => m.aliases.some((a) => n.includes(normalizeAr(a))));
};

export const isOrderForModerator = (
  moderator: ModeratorConfig,
  orderModerator: string | null,
  creatorFullName: string | null,
): boolean => {
  const nameMatches = (c: string) => {
    const n = normalizeAr(c);
    return moderator.aliases.some((a) => n.includes(normalizeAr(a)));
  };
  // مصدر الحقيقة هو حقل "المسوقة المسؤولة" (orders.moderator).
  // لو تم نقل الأوردر لمسوقة أخرى أو للشركة، لا يُحتسب لمن سجّلته.
  const owner = (orderModerator || "").trim();
  if (owner) return nameMatches(owner);
  return creatorFullName ? nameMatches(creatorFullName) : false;
};


// مطابقة اسم مسوقة مع مفتاح تجميع مع مراعاة كل التسميات البديلة
// (مثال: "منال" و"هاجر" نفس الشخص).
export const matchesModeratorGroup = (name?: string | null, target?: string | null): boolean => {
  if (!name || !target) return false;
  const n = normalizeAr(name);
  const t = normalizeAr(target);
  const cfg = MODERATORS.find((m) =>
    m.aliases.some((a) => t.includes(normalizeAr(a))),
  );
  const candidates = cfg ? cfg.aliases : [target];
  return candidates.some((a) => n.includes(normalizeAr(a)));
};
