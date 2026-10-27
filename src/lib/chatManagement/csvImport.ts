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

// ───── CDR (تصدير بوابة الهوت لاين: zip فيه CDR.csv + Switched.csv) ─────
// الأعمدة بالضبط كما في التصدير الفعلي؛ Cdr Id هو مفتاح عدم التكرار (السجلات تختفي من البوابة بعد 5 أيام → أعيدي الرفع كل بضعة أيام).
export const CDR_COLUMNS = ["Cdr Id", "A Number", "Customer Name", "B Number", "Call Record", "Voicemail", "Start Time", "End Time",
  "Switched Time", "Call Result", "Call Duration", "Call Direction"] as const;
export const SWITCHED_COLUMNS = ["Cdr Id", "Username", "Switch Time", "Switching Status", "Call Status", "Answer Time", "End Time"] as const;
const CDR_REQUIRED = ["Cdr Id", "A Number", "B Number", "Start Time", "Call Direction"];
const SW_REQUIRED = ["Cdr Id", "Username", "Switching Status"];
export const KNOWN_CALL_RESULTS = ["ANSWERED", "ANSWERED_BY_AGENT"];
export const CDR_ID_RE = /^CDR\.\d{6}\.\d{6}\.[A-Za-z0-9]+$/;

export interface SwitchAttempt { username: string; switch_time?: string; switching_status: string; call_status?: string; answer_time?: string; end_time?: string }
export interface CdrRow {
  cdr_id: string; a_number: string; b_number: string; customer_name?: string; call_record?: string; start_time: string; end_time?: string;
  call_result?: string; call_duration?: string; call_direction: string; attempts: SwitchAttempt[];
  // للمعاينة فقط (لا تُرسل): الحالة/المودريتور المشتقّان والرقم المطبَّع
  preview: { status: "answered" | "missed" | "failed"; username: string | null; phone: string | null; unknownResult: boolean };
}
export interface CdrParse { rows: CdrRow[]; issues: RowIssue[]; missingColumns: string[]; unknownResults: string[]; orphanSwitched: number }

const headerIndex = (h: string[]) => { const m = new Map(h.map((x, i) => [x.replace(/^\uFEFF/, "").trim().toLowerCase(), i])); return (c: string) => m.get(c.toLowerCase()) ?? -1; };
/** DD-MM-YYYY HH:MM:SS (توقيت القاهرة المحلي) — يُرسل كما هو والخادم يحوّله؛ هنا فقط للتحقق. */
export const CDR_TS_RE = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;
export const isValidCdrTime = (s: string) => { const m = CDR_TS_RE.exec(s.trim()); if (!m) return false;
  const [d, mo, , h, mi, se] = m.slice(1).map(Number); return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && h < 24 && mi < 60 && se < 60; };
export const parseCdrDuration = (s: string | undefined): number | null => { const t = (s ?? "").trim(); if (!t) return 0;
  const m = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(t); if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3]; return /^\d+$/.test(t) ? +t : null; };

/** حالة المكالمة: مفقودة إذا لا توجد محاولة ACCEPTED (نفس منطق الخادم). */
export const deriveCdrStatus = (direction: string, result: string | undefined, attempts: SwitchAttempt[]) => {
  if (attempts.some((a) => a.switching_status.toUpperCase() === "ACCEPTED")) return "answered" as const;
  if (direction === "INBOUND") return "missed" as const;
  return /^ANSWERED/.test((result ?? "").toUpperCase()) ? "answered" as const : "failed" as const;
};
const deriveUsername = (attempts: SwitchAttempt[]) => {
  const acc = attempts.find((a) => a.switching_status.toUpperCase() === "ACCEPTED");
  return (acc ?? attempts[attempts.length - 1])?.username.trim().toLowerCase() || null;
};

export const mapSwitched = (table: string[][]): { byId: Map<string, SwitchAttempt[]>; missingColumns: string[] } => {
  const [h = [], ...body] = table; const ix = headerIndex(h);
  const missingColumns = SW_REQUIRED.filter((c) => ix(c) < 0).map((c) => `Switched.csv: ${c}`);
  const byId = new Map<string, SwitchAttempt[]>();
  if (missingColumns.length) return { byId, missingColumns };
  for (const r of body) {
    const g = (c: string) => (ix(c) >= 0 ? (r[ix(c)] ?? "").trim() : "");
    const id = g("Cdr Id"); if (!id) continue;
    const a: SwitchAttempt = { username: g("Username"), switching_status: g("Switching Status").toUpperCase() };
    const opt = { switch_time: g("Switch Time"), call_status: g("Call Status"), answer_time: g("Answer Time"), end_time: g("End Time") };
    for (const [k, v] of Object.entries(opt)) if (v) (a as unknown as Record<string, string>)[k] = v;
    (byId.get(id) ?? byId.set(id, []).get(id)!).push(a);
  }
  for (const list of byId.values()) list.sort((x, y) => (x.switch_time ?? "").localeCompare(y.switch_time ?? ""));
  return { byId, missingColumns };
};

export const mapCdr = (cdr: string[][], switched?: string[][]): CdrParse => {
  const [h = [], ...body] = cdr; const ix = headerIndex(h);
  const sw = switched ? mapSwitched(switched) : { byId: new Map<string, SwitchAttempt[]>(), missingColumns: [] };
  const missingColumns = [...CDR_REQUIRED.filter((c) => ix(c) < 0).map((c) => `CDR.csv: ${c}`), ...sw.missingColumns];
  if (missingColumns.length) return { rows: [], issues: [], missingColumns, unknownResults: [], orphanSwitched: 0 };
  const rows: CdrRow[] = []; const issues: RowIssue[] = []; const seen = new Set<string>(); const unknown = new Set<string>();
  body.forEach((r, i) => {
    const g = (c: string) => (ix(c) >= 0 ? (r[ix(c)] ?? "").trim() : "");
    const n = i + 2; const id = g("Cdr Id"); const dir = g("Call Direction").toUpperCase();
    const phoneRaw = dir === "OUTBOUND" ? g("B Number") : g("A Number");
    const reason = !id ? "Cdr Id ناقص" : seen.has(id) ? "مكرر داخل الملف" : dir !== "INBOUND" && dir !== "OUTBOUND" ? "اتجاه غير معروف"
      : !isValidCdrTime(g("Start Time")) ? "وقت البدء غير صالح (المتوقع DD-MM-YYYY HH:MM:SS)"
      : parseCdrDuration(g("Call Duration")) === null ? "مدة غير صالحة (المتوقع HH:MM:SS)"
      : !previewNormalizePhone(phoneRaw) ? "رقم العميل غير صالح" : null;
    if (reason) { issues.push({ row: n, reason }); return; }
    seen.add(id);
    const attempts = sw.byId.get(id) ?? []; const result = g("Call Result").toUpperCase();
    const unknownResult = !!result && !KNOWN_CALL_RESULTS.includes(result); if (unknownResult) unknown.add(result);
    const row: CdrRow = { cdr_id: id, a_number: g("A Number"), b_number: g("B Number"), start_time: g("Start Time"), call_direction: dir, attempts,
      preview: { status: deriveCdrStatus(dir, result, attempts), username: deriveUsername(attempts), phone: previewNormalizePhone(phoneRaw), unknownResult } };
    const opt = { customer_name: g("Customer Name"), call_record: g("Call Record"), end_time: g("End Time"), call_result: result, call_duration: g("Call Duration") };
    for (const [k, v] of Object.entries(opt)) if (v) (row as unknown as Record<string, string>)[k] = v;
    rows.push(row);
  });
  const orphanSwitched = [...sw.byId.keys()].filter((k) => !seen.has(k)).length;
  return { rows, issues, missingColumns, unknownResults: [...unknown], orphanSwitched };
};

/** الصف كما يُرسل لـ cm_import_hotline_cdr (بدون حقول المعاينة واسم العميل). */
export const toCdrPayload = ({ preview: _p, customer_name: _c, ...r }: CdrRow) => r;

/** قراءة ملفات المستخدم: zip (CDR.csv + Switched.csv) أو الملفين منفصلين. */
export const readCdrFiles = async (files: { name: string; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }[]) => {
  const texts: Record<string, string> = {};
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const { unzipSync, strFromU8 } = await import("fflate");
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: (e) => /\.csv$/i.test(e.name) && !(e.originalSize > 20_000_000) });
      for (const [name, data] of Object.entries(entries)) texts[name.split("/").pop()!.toLowerCase()] = strFromU8(data);
    } else texts[f.name.toLowerCase()] = await f.text();
  }
  const cdr = Object.entries(texts).find(([k]) => /^cdr.*\.csv$/.test(k))?.[1];
  const sw = Object.entries(texts).find(([k]) => /^switched.*\.csv$/.test(k))?.[1];
  if (!cdr) return { ...mapCdr([[]]), missingColumns: ["ملف CDR.csv غير موجود"] } as CdrParse;
  return mapCdr(parseCsv(cdr), sw ? parseCsv(sw) : undefined);
};

// ───── مطابقة ملفات التسجيل بالمكالمات ─────
export interface MatchableCall { id: string; external_call_id: string | null; phone_norm: string | null; started_at: string }
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg",
  opus: "audio/opus", webm: "audio/webm", amr: "audio/amr", "3gp": "audio/3gpp" };
export const audioMimeFor = (name: string) => AUDIO_EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
export const RECORDING_MAX_BYTES = 50 * 1024 * 1024;
/** بالـ Cdr Id داخل اسم الملف، وإلا رقم + وقت (YYYYMMDD[-_ ]HHMMSS) خلال ±2 دقيقة وبنتيجة وحيدة. */
export const matchRecording = (fileName: string, calls: MatchableCall[]): { call: MatchableCall | null; by: "cdr_id" | "phone_time" | null; reason?: string } => {
  const base = fileName.split("/").pop() ?? fileName;
  const id = /CDR\.\d{6}\.\d{6}\.[A-Za-z0-9]+/.exec(base)?.[0];
  if (id) { const c = calls.find((x) => x.external_call_id === id); return c ? { call: c, by: "cdr_id" } : { call: null, by: null, reason: "Cdr Id غير موجود في المكالمات المستوردة" }; }
  const digits = toLatinDigits(base);
  const phone = (digits.match(/(?:\+?20|0)?1[0125]\d{8}/g) ?? []).map(previewNormalizePhone).find(Boolean);
  const t = /(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_ T]?(\d{2})[-_:]?(\d{2})[-_:]?(\d{2})/.exec(digits);
  if (!phone || !t) return { call: null, by: null, reason: "لا يحتوي الاسم على Cdr Id ولا رقم + وقت" };
  // وقت الاسم محلي للقاهرة (+02 شتاءً / +03 صيفاً)
  const local = `${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}:${t[6]}`;
  const near = (c: MatchableCall) => ["+02:00", "+03:00"].some((o) => Math.abs(Date.parse(c.started_at) - Date.parse(local + o)) <= 120_000);
  const hits = calls.filter((c) => c.phone_norm === phone && near(c));
  return hits.length === 1 ? { call: hits[0], by: "phone_time" } : { call: null, by: null, reason: hits.length ? "أكثر من مكالمة مطابقة" : "لا مكالمة مطابقة" };
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
