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
  aliases: string[];
  gradient: string; // tailwind gradient classes for the card
  iconBg: string;
}

export const MODERATORS: ModeratorConfig[] = [
  {
    slug: "aya",
    displayName: "آية",
    canonicalModerator: "أية",
    aliases: ["اية", "آية", "أية", "ايه", "آيه", "أيه"],
    gradient: "from-primary to-primary/70",
    iconBg: "bg-primary",
  },
  {
    slug: "noura",
    displayName: "نورا",
    canonicalModerator: "نورا",
    aliases: ["نورا", "نوره", "نورة"],
    gradient: "from-secondary to-secondary/70",
    iconBg: "bg-secondary",
  },
  {
    slug: "sara",
    displayName: "سارة",
    canonicalModerator: "سارة",
    aliases: ["سارة", "ساره", "سارا"],
    gradient: "from-success to-success/70",
    iconBg: "bg-success",
  },
  {
    slug: "manal",
    displayName: "منال",
    canonicalModerator: "منال",
    aliases: ["منال"],
    gradient: "from-chart-4 to-chart-4/70",
    iconBg: "bg-chart-4",
  },
];

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
  const candidates = [orderModerator, creatorFullName].filter(Boolean) as string[];
  return candidates.some((c) => {
    const n = normalizeAr(c);
    return moderator.aliases.some((a) => n.includes(normalizeAr(a)));
  });
};
