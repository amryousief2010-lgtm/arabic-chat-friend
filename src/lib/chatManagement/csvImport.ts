// استيراد CSV يدوي (CDR الخط الساخن + الإنفاق اليومي): تحليل في المتصفح، تحقق، معاينة، ثم إرسال للدالة.
// الأرقام تُطبَّع في قاعدة البيانات (cm_normalize_phone)؛ هنا تطبيع معاينة بنفس القواعد.

/** تحليل CSV بسيط يدعم علامات الاقتباس و BOM والفاصل , أو ; أو Tab. */
export const parseCsv = (text: string): string[][] => {
  const src = text.replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
};

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
export const toLatinDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => String(AR_DIGITS.indexOf(d) % 10));
export const previewNormalizePhone = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  let s = toLatinDigits(raw).replace(/\D/g, "");
  if (s.startsWith("0020")) s = s.slice(4);
  else if (/^20\d{10}$/.test(s)) s = s.slice(2);
  else if (/^020\d{10}$/.test(s)) s = s.slice(3);
  if (/^1\d{9}$/.test(s)) s = "0" + s;
  return /^01[0125]\d{8}$/.test(s) ? s : null;
};

const pick = (h: string[], aliases: string[]) => h.findIndex((x) => aliases.includes(x.trim().toLowerCase()));
export interface RowIssue { row: number; reason: string }

// ───── CDR ─────
export const CDR_HEADERS: Record<string, string[]> = {
  external_call_id: ["call_id", "id", "uniqueid", "external_call_id", "رقم المكالمة"],
  direction: ["direction", "type", "الاتجاه"],
  started_at: ["started_at", "start", "date", "calldate", "الوقت", "التاريخ"],
  duration_sec: ["duration", "duration_sec", "billsec", "المدة"],
  status: ["status", "disposition", "الحالة"],
  phone: ["phone", "caller", "number", "src", "الرقم"],
  moderator: ["moderator", "agent", "extension", "المودريتور"],
  line: ["line", "trunk", "الخط"],
  recording_path: ["recording_path", "recording", "التسجيل"],
};
const DIR: Record<string, "inbound" | "outbound"> = { inbound: "inbound", in: "inbound", incoming: "inbound", "وارد": "inbound",
  outbound: "outbound", out: "outbound", outgoing: "outbound", "صادر": "outbound" };
const STATUS: Record<string, string> = { answered: "answered", "no answer": "missed", noanswer: "missed", missed: "missed", "فائتة": "missed",
  "لم يتم الرد": "missed", busy: "busy", failed: "failed", voicemail: "voicemail", "تم الرد": "answered" };

export interface CdrRow { external_call_id: string; direction: "inbound" | "outbound"; started_at: string; duration_sec: number;
  status: string; phone: string; phone_preview: string | null; moderator?: string; line?: string; recording_path?: string }

export const mapCdr = (table: string[][]): { rows: CdrRow[]; issues: RowIssue[]; missingColumns: string[] } => {
  const [h = [], ...body] = table;
  const idx = Object.fromEntries(Object.entries(CDR_HEADERS).map(([k, a]) => [k, pick(h, a)]));
  const required = ["external_call_id", "direction", "started_at", "status", "phone"];
  const missingColumns = required.filter((k) => idx[k] < 0);
  if (missingColumns.length) return { rows: [], issues: [], missingColumns };
  const rows: CdrRow[] = []; const issues: RowIssue[] = []; const seen = new Set<string>();
  body.forEach((r, i) => {
    const g = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const n = i + 2; const id = g("external_call_id");
    const direction = DIR[g("direction").toLowerCase()]; const status = STATUS[g("status").toLowerCase()];
    const started = new Date(g("started_at").replace(" ", "T"));
    const dur = g("duration_sec") === "" ? 0 : Number(toLatinDigits(g("duration_sec")));
    const rec = g("recording_path");
    const reason = !id ? "رقم المكالمة ناقص" : seen.has(id) ? "مكرر داخل الملف" : !direction ? "اتجاه غير معروف"
      : !status ? "حالة غير معروفة" : isNaN(+started) ? "وقت غير صالح" : !Number.isFinite(dur) || dur < 0 ? "مدة غير صالحة"
      : !previewNormalizePhone(g("phone")) ? "رقم غير صالح" : rec && (/^[a-z]+:\/\//i.test(rec) || /[?#]/.test(rec) || rec.includes(".."))
      ? "التسجيل يجب أن يكون مساراً داخل التخزين وليس رابطاً" : null;
    if (reason) { issues.push({ row: n, reason }); return; }
    seen.add(id);
    rows.push({ external_call_id: id, direction, started_at: g("started_at"), duration_sec: Math.round(dur), status, phone: g("phone"),
      phone_preview: previewNormalizePhone(g("phone")), moderator: g("moderator") || undefined, line: g("line") || undefined,
      recording_path: rec || undefined });
  });
  return { rows, issues, missingColumns };
};

// ───── الإنفاق اليومي ─────
export const SPEND_HEADERS: Record<string, string[]> = {
  campaign: ["campaign", "campaign_name", "campaign name", "الحملة"],
  meta_campaign_id: ["campaign_id", "campaign id", "meta_campaign_id"],
  spend_date: ["date", "day", "reporting starts", "spend_date", "التاريخ"],
  spend: ["spend", "amount spent", "amount spent (egp)", "amount", "الإنفاق"],
  currency: ["currency", "العملة"],
  impressions: ["impressions", "مرات الظهور"],
  clicks: ["clicks", "link clicks", "النقرات"],
};
export interface SpendRow { campaign_name?: string; meta_campaign_id?: string; spend_date: string; spend: number; currency: string;
  impressions?: number; clicks?: number }

export const mapSpend = (table: string[][]): { rows: SpendRow[]; issues: RowIssue[]; missingColumns: string[] } => {
  const [h = [], ...body] = table;
  const idx = Object.fromEntries(Object.entries(SPEND_HEADERS).map(([k, a]) => [k, pick(h, a)]));
  const missingColumns = [idx.campaign < 0 && idx.meta_campaign_id < 0 ? "campaign" : "", idx.spend_date < 0 ? "spend_date" : "",
    idx.spend < 0 ? "spend" : ""].filter(Boolean);
  if (missingColumns.length) return { rows: [], issues: [], missingColumns };
  const rows: SpendRow[] = []; const issues: RowIssue[] = []; const seen = new Set<string>();
  body.forEach((r, i) => {
    const g = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const n = i + 2; const date = g("spend_date"); const spend = Number(toLatinDigits(g("spend")).replace(/[,\s]/g, ""));
    const camp = g("meta_campaign_id") || g("campaign"); const key = `${camp}|${date}`;
    const currency = (g("currency") || "EGP").toUpperCase();
    const num = (k: string) => (g(k) === "" ? undefined : Number(toLatinDigits(g(k)).replace(/[,\s]/g, "")));
    const reason = !camp ? "الحملة ناقصة" : !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(+new Date(date)) ? "تاريخ غير صالح (YYYY-MM-DD)"
      : !Number.isFinite(spend) || spend < 0 ? "مبلغ غير صالح" : !/^[A-Z]{3}$/.test(currency) ? "عملة غير صالحة"
      : seen.has(key) ? "مكرر داخل الملف" : null;
    if (reason) { issues.push({ row: n, reason }); return; }
    seen.add(key);
    rows.push({ campaign_name: g("campaign") || undefined, meta_campaign_id: g("meta_campaign_id") || undefined, spend_date: date,
      spend: Math.round(spend * 100) / 100, currency, impressions: num("impressions"), clicks: num("clicks") });
  });
  return { rows, issues, missingColumns };
};
