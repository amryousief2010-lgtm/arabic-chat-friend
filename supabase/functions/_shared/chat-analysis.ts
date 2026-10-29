// منطق نقي لتحليل محادثات واتساب (قابل للاختبار): بناء النص المحجوب + تطبيع مخرجات النموذج.
export const CHAT_CATEGORIES = ["price_inquiry", "order_request", "product_info", "availability", "delivery_inquiry", "complaint", "followup", "wholesale", "other"] as const;
export const CHAT_OUTCOMES = ["order_placed", "order_promised", "inquiry_only", "not_interested", "complaint", "no_reply", "followup", "other"] as const;

/** يحجب أرقام الهواتف/الأرقام الطويلة (لاتيني أو عربي) والبريد والروابط. */
export const redact = (s: string) => s
  .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[بريد]")
  .replace(/https?:\/\/\S+/g, "[رابط]")
  .replace(/(?:\+?[\d٠-٩][\d٠-٩\s\-]{6,}[\d٠-٩])/g, "[رقم]");

const MEDIA_AR: Record<string, string> = { image: "[صورة]", audio: "[رسالة صوتية]", video: "[فيديو]", document: "[ملف]", sticker: "[ملصق]", location: "[موقع]", contacts: "[جهة اتصال]" };

export interface ChatMsg { direction: string; type: string | null; body: string | null; sent_at: string }

/** نص المحادثة بأدوار فقط (عميل/مودريتور) — بلا أرقام ولا أسماء ملفات. */
export function buildChatTranscript(msgs: ChatMsg[], maxChars = 30000): string {
  const lines = [...msgs].sort((a, b) => a.sent_at.localeCompare(b.sent_at)).map((m) => {
    const who = m.direction === "out" ? "المودريتور" : "العميل";
    const media = m.type && m.type !== "text" ? (MEDIA_AR[m.type] ?? `[${m.type}]`) : "";
    const text = m.body ? redact(m.body).replace(/\s+/g, " ").trim() : "";
    const t = m.sent_at.slice(11, 16);
    return `[${t}] ${who}: ${[media, text].filter(Boolean).join(" ") || "[فارغ]"}`;
  });
  const outN = msgs.filter((m) => m.direction === "out").length;
  let out = `(عدد رسائل العميل: ${msgs.length - outN}، عدد رسائل المودريتور: ${outN})\n` + lines.join("\n");
  if (out.length > maxChars) out = out.slice(0, maxChars / 2) + "\n…\n" + out.slice(-maxChars / 2);
  return out;
}

/** بصمة بسيطة: تتغير مع أي رسالة جديدة. */
export function chatHash(msgs: ChatMsg[]): string {
  let h = 2166136261;
  for (const m of msgs) for (const ch of `${m.sent_at}|${m.direction}|${m.body ?? ""};`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `${msgs.length}:${(h >>> 0).toString(16)}`;
}

/** no_reply حقيقة SQL وليست تقديراً: صفر رسائل صادرة ⇔ no_reply. */
export function fixOutcome(outcome: string, moderatorReplies?: number): string {
  if (moderatorReplies === undefined) return outcome;
  if (moderatorReplies === 0) return "no_reply";
  return outcome === "no_reply" ? "inquiry_only" : outcome;
}

// deno-lint-ignore no-explicit-any
export function normalizeChatAnalysis(a: any, moderatorReplies?: number) {
  const score = Math.round(Number(a?.quality_score));
  const strip = (v: unknown) => (typeof v === "string" && v.trim() ? redact(v.trim()).slice(0, 1500) : null);
  return {
    category: (CHAT_CATEGORIES as readonly string[]).includes(a?.category) ? a.category : "other",
    intent: strip(a?.intent),
    outcome: fixOutcome((CHAT_OUTCOMES as readonly string[]).includes(a?.outcome) ? a.outcome : "other", moderatorReplies),
    objections: Array.isArray(a?.objections) ? a.objections.map((o: unknown) => redact(String(o)).slice(0, 80)).filter(Boolean).slice(0, 8) : [],
    quality_score: score >= 1 && score <= 5 ? score : null,
    quality_notes: strip(a?.quality_notes),
    summary_ar: strip(a?.summary_ar),
    followup_needed: typeof a?.followup_needed === "boolean" ? a.followup_needed : null,
  };
}

export const CHAT_SYSTEM = `أنت محلل جودة مبيعات لشركة «نعام العاصمة» (لحوم ومنتجات النعام) في مصر. ستصلك محادثة واتساب بين «المودريتور» (موظفة المبيعات) و«العميل»، مرتبة زمنياً. الأرقام محجوبة بـ [رقم] والوسائط تظهر كـ [صورة] وغيرها.
أعد JSON فقط بالمفاتيح:
category: واحد من ${CHAT_CATEGORIES.join(", ")} (أهم غرض للعميل).
intent: نية العميل في جملة قصيرة.
outcome: واحد من ${CHAT_OUTCOMES.join(", ")} (no_reply فقط إذا كان عدد رسائل المودريتور صفراً، order_placed إذا أكد العميل الطلب بالعنوان/الكمية، order_promised إذا وعد).
objections: مصفوفة اعتراضات قصيرة موحدة الصياغة (مثل "السعر مرتفع"، "مصاريف الشحن"، "منطقة خارج التغطية"، "يريد التفكير") أو [].
quality_score: عدد صحيح 1-5 لرد المودريتور (سرعة الفهم، وضوح السعر والمنتج، معالجة الاعتراض، محاولة إغلاق البيع، اللباقة). إذا لم يرد المودريتور فـ 1.
quality_notes: ملاحظات محددة على رد المودريتور (نقطة قوة + ما يحتاج تحسيناً) بجملتين أو ثلاث.
summary_ar: ملخص من 1 إلى 3 جمل بالعربية.
followup_needed: true/false.
لا تذكر أي أرقام هواتف أو أسماء عملاء أو عناوين في أي حقل.`;
