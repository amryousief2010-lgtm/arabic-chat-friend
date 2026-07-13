/**
 * Parser for Bostta delivery sheet product text.
 *
 * Sheet product cell examples:
 *  - "نص لحم نص استيك نص موزه نص كفته نص مفروم نص سجق"
 *  - "ك برجر هديه"
 *  - "ك لحم ك كفته ك برجر ك مفروم نص كفته أرز نص نخاع"
 *
 * Tokens:
 *  - "نص"  → 0.5
 *  - "ك"   → 1
 *  - "2ك" | "3ك" | ... → 2, 3, ...
 * Followed by product keywords which we match to catalog by normalized name.
 */

export interface CatalogProduct {
  id: string;
  name: string;
  unit: string;
  price: number;
}

export interface ParsedItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  is_gift?: boolean;
  raw_token: string;
}

export interface ParsedProductLine {
  items: ParsedItem[];
  unknown_tokens: string[];
  original_text: string;
}

/**
 * Normalize Arabic for matching: strip diacritics, unify ي/ى, ة/ه, أإآ→ا,
 * remove tatweel, collapse whitespace.
 */
export function normalizeArabic(s: string): string {
  if (!s) return "";
  // Convert Arabic-Indic + Extended-Arabic digits to ASCII
  const digitMap: Record<string, string> = {
    "٠":"0","١":"1","٢":"2","٣":"3","٤":"4","٥":"5","٦":"6","٧":"7","٨":"8","٩":"9",
    "۰":"0","۱":"1","۲":"2","۳":"3","۴":"4","۵":"5","۶":"6","۷":"7","۸":"8","۹":"9",
  };
  return s
    .replace(/[٠-٩۰-۹]/g, (d) => digitMap[d] || d)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "") // diacritics + tatweel
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/،/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Aliases: normalized keyword → canonical catalog product name.
 * These handle the common Bostta shorthand that differs from catalog names.
 */
const ALIASES: Record<string, string> = {
  // half-kilo variants often written slightly different
  "لحم": "لحم قطع",
  "لحمه": "لحم قطع",
  "لحمة": "لحم قطع",
  "لحم قطع": "لحم قطع",

  "قطع لحم": "لحم قطع",
  "استيك": "استيك",
  "موزه": "موزه",
  "موز": "موزه",
  "كفته": "كفته",
  "كفتة": "كفته",
  "مفروم": "مفروم",
  "فرم": "مفروم",
  "سجق": "سجق",
  "كفته ارز": "كفته الرز",
  "كفته أرز": "كفته الرز",
  "كفته رز": "كفته الرز",
  "كفتة ارز": "كفته الرز",
  "كفتة أرز": "كفته الرز",
  "كفتة رز": "كفته الرز",
  "نخاع": "نخاع",
  "قوانص": "قوانص",
  "كوارع": "كوارع",
  "كبده": "كبده",
  "كبد": "كبده",
  "رقاب": "رقاب",
  "رقبه": "رقاب",
  "رقبة": "رقاب",
  "برجر": "برجر",
  "برجر جبنه": "برجر جبنه",
  "برجر جبنة": "برجر جبنه",
  "حواوشي": "حواوشي",
  "شاورما": "شاورما",
  "شيش": "شيش",
  "طرب": "طرب",
  "قلب": "قلب",
  "ممبار": "ممبار",
  "دبوس": "قطعيه الدبوس",
  "دبووس": "قطعيه الدبوس",
  "قطعيه الدبوس": "قطعيه الدبوس",
  "قطعية الدبوس": "قطعيه الدبوس",
  "دبوس بالعظم": "قطعيه الدبوس",
  "دبوس بالعضم": "قطعيه الدبوس",
  "دبوس بالعضمه": "قطعيه الدبوس",
  "دبوس بالعظمه": "قطعيه الدبوس",
  "دهن": "دهن النعام",
  "دهن نعام": "دهن النعام",
  "دهن النعام": "دهن النعام",
  "بيض": "بيض",
  "بيضه": "بيض",
  "بيضة": "بيض",
  "بيضات": "بيض",
  "شغت": "شغت نعام",
  "شغت نعام": "شغت نعام",
  "قطع كباب": "قطع كباب",
  "كباب": "قطع كباب",
  "رول": "رول",
  "فراشه": "فراشه",
  "فراشة": "فراشه",
  "فخده": "فخده  بالعظم",
  "فخدة": "فخده  بالعظم",
  "فخده بالعظم": "فخده  بالعظم",
  "فخدة بالعظم": "فخده  بالعظم",
  "اسكالوب": "اسكالوب",
  "تربيانكو": "تربيانكو",
  "بان فلت": "بان فلت",
  "فرم نعام": "فرم نعام",
  "نعامه بالعظم": "نعامه صندوق بالعظم",
  "نعامة بالعظم": "نعامه صندوق بالعظم",
  "نعامه صندوق بالعظم": "نعامه صندوق بالعظم",
  "نعامة صندوق بالعظم": "نعامه صندوق بالعظم",
};

/** Sort keys longest-first so multi-word aliases match before their prefix. */
const ALIAS_KEYS_SORTED = Object.keys(ALIASES).sort((a, b) => b.length - a.length);

const GIFT_TOKENS = new Set(["هديه", "هدية"]);

/** Build lookup of normalized catalog name → product. */
export function buildProductLookup(products: CatalogProduct[]): Map<string, CatalogProduct> {
  const map = new Map<string, CatalogProduct>();
  for (const p of products) {
    map.set(normalizeArabic(p.name), p);
  }
  return map;
}

/**
 * Parse the free-text product cell into structured items.
 * Algorithm: walk left→right, treat quantity token (نص | ك | Nك) as a new item boundary.
 */
export function parseProductText(
  text: string,
  productLookup: Map<string, CatalogProduct>,
  codAmount?: number
): ParsedProductLine {
  const original = String(text || "");
  let norm = normalizeArabic(original);
  // Merge "digit + space + ك/كيلو" into a single qty token: "2 ك" -> "2ك", "3 كيلو" -> "3كيلو"
  norm = norm.replace(/(\d+)\s+(كيلو|ك)(?=\s|$)/g, "$1$2");
  // Eggs are sold by count, not by kilo. Convert "N بيض/بيضة/بيضه/بيضات" -> "Nك بيض"
  norm = norm.replace(/(\d+)\s*بيض(ه|ة|ات)?(?=\s|$)/g, "$1ك بيض");
  // Bare "بيضه/بيضة" (single egg) -> "ك بيض"
  norm = norm.replace(/(^|\s)بيض(ه|ة)(?=\s|$)/g, "$1ك بيض");
  // "دبوس بالعضم/بالعظم" -> collapse to just "دبوس" so alias resolver catches it
  norm = norm.replace(/دبوس\s+بال?ع[ضظ]م(ه)?/g, "دبوس");
  // Expand Arabic dual (تثنية) shortcuts to "2ك <word>" (space-delimited since \b doesn't work on Arabic)
  const dualMap: Record<string,string> = {
    "دبوسين":"2ك دبوس","بيضتين":"2ك بيض","رقبتين":"2ك رقاب","كيلوين":"2ك","كيلوهين":"2ك",
  };
  norm = norm.split(" ").map(w => dualMap[w] || w).join(" ");

  const tokens = norm.split(" ").filter(Boolean);


  const items: ParsedItem[] = [];
  const unknown: string[] = [];

  // Grouping: {qty, words}
  interface Bucket { qty: number; words: string[]; isGiftHint: boolean; }
  const buckets: Bucket[] = [];
  let current: Bucket | null = null;

  const qtyRegex = /^(\d+)?ك$/; // "ك", "2ك", "3ك"
  const kiloWordRegex = /^(\d+)?كيلو$/; // "كيلو", "2كيلو"

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // "نص" alone → 0.5 (but if previous bucket just opened with qty and no words yet, add to it: e.g. "كيلو ونص")
    if (t === "نص" || t === "ونص") {
      if (current && current.words.length === 0) {
        current.qty += 0.5;
      } else {
        if (current) buckets.push(current);
        current = { qty: 0.5, words: [], isGiftHint: false };
      }
      continue;
    }
    // "كيلو" or "Nكيلو"
    const km = t.match(kiloWordRegex);
    if (km) {
      if (current) buckets.push(current);
      const n = km[1] ? parseInt(km[1], 10) : 1;
      current = { qty: n, words: [], isGiftHint: false };
      continue;
    }
    const m = t.match(qtyRegex);
    if (m) {
      if (current) buckets.push(current);
      const n = m[1] ? parseInt(m[1], 10) : 1;
      current = { qty: n, words: [], isGiftHint: false };
      continue;
    }
    if (GIFT_TOKENS.has(t)) {
      if (current) current.isGiftHint = true;
      continue;
    }
    if (!current) {
      unknown.push(t);
      continue;
    }
    current.words.push(t);
  }

  if (current) buckets.push(current);

  // Resolve each bucket → best matching product using ALIASES first, then longest-substring match against catalog
  for (const b of buckets) {
    const phrase = b.words.join(" ").trim();
    if (!phrase) continue;

    // Try alias match: longest alias key that appears as a whole phrase or prefix
    let canonical: string | null = null;
    let matchedRaw = phrase;
    for (const key of ALIAS_KEYS_SORTED) {
      if (phrase === key || phrase.startsWith(key + " ") || phrase.endsWith(" " + key) || phrase.includes(" " + key + " ")) {
        canonical = ALIASES[key];
        matchedRaw = key;
        break;
      }
    }
    if (!canonical) {
      // Try each word individually as alias
      for (const w of b.words) {
        if (ALIASES[w]) { canonical = ALIASES[w]; matchedRaw = w; break; }
      }
    }
    if (!canonical) {
      // Try direct catalog match on any substring
      for (const [cname] of productLookup) {
        if (phrase.includes(cname) || cname.includes(phrase)) {
          canonical = cname; matchedRaw = phrase; break;
        }
      }
    }

    if (!canonical) {
      unknown.push(`${b.qty === 0.5 ? "نص" : b.qty + "ك"} ${phrase}`);
      continue;
    }

    const product = productLookup.get(normalizeArabic(canonical));
    if (!product) {
      unknown.push(`${b.qty === 0.5 ? "نص" : b.qty + "ك"} ${phrase} (لا يوجد في الكاتالوج)`);
      continue;
    }

    items.push({
      product_id: product.id,
      product_name: product.name,
      quantity: b.qty,
      unit: product.unit,
      unit_price: b.isGiftHint ? 0 : product.price,
      is_gift: b.isGiftHint || undefined,
      raw_token: matchedRaw,
    });
  }

  // Rule: بارت "دبوس" لو البنت مكتبتش "قطعية" وسعر التحصيل > 2000 → دبوس بالعظم (باكة 6ك)
  // أو لو مكتوب صراحة "بالعظم/بالعضم". الافتراضي بغير كده يفضل قطعية الدبوس (فيليه).
  const rawNorm = normalizeArabic(original);
  const mentionsFillet = /قطعي[ةه]\s*(ال)?دبوس/.test(rawNorm) || /دبوس\s*قطعي[ةه]/.test(rawNorm);
  const mentionsBoneIn = /دبوس\s*بال?ع[ضظ]م(ه)?/.test(String(original).replace(/[أإآا]/g, "ا"));
  const codOverThreshold = typeof codAmount === "number" && codAmount > 2000;
  if (!mentionsFillet && (mentionsBoneIn || codOverThreshold)) {
    const bonePack = productLookup.get(normalizeArabic("6ك دبوس بالعظم"));
    if (bonePack) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.product_name && /قطعي[ةه]\s*الدبوس/.test(normalizeArabic(it.product_name))) {
          items[i] = {
            product_id: bonePack.id,
            product_name: bonePack.name,
            quantity: 1,
            unit: bonePack.unit,
            unit_price: it.is_gift ? 0 : bonePack.price,
            is_gift: it.is_gift,
            raw_token: it.raw_token,
          };
        }
      }
    }
  }

  return { items, unknown_tokens: unknown, original_text: original };
}

/** Aggregate duplicate items (same product_id) by summing quantities, keeping earliest unit_price. */
export function consolidateItems(items: ParsedItem[]): ParsedItem[] {
  const acc = new Map<string, ParsedItem>();
  for (const it of items) {
    const key = it.product_id + "|" + (it.is_gift ? "gift" : "sale");
    const prev = acc.get(key);
    if (prev) {
      prev.quantity += it.quantity;
    } else {
      acc.set(key, { ...it });
    }
  }
  return Array.from(acc.values());
}

/** Normalize an Egyptian phone number to 11-digit "01xxxxxxxxx" form when possible. */
export function normalizePhone(p: string | number | null | undefined): string {
  if (p == null) return "";
  let s = String(p).replace(/\D/g, "");
  if (s.startsWith("2") && s.length === 12) s = s.slice(1); // strip country code
  if (s.length === 10 && s.startsWith("1")) s = "0" + s;
  return s;
}
