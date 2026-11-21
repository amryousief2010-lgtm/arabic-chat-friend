// Edge Function: whatsapp-webhook — استقبال رسائل واتساب من Meta.
// v4 (2026-11-20): عزل الاستقبال عن طابور اتصالات التطبيق. عند WA_DIRECT_DB=1 تُنفَّذ دوال الاستقبال عبر اتصال مباشر
// (Supavisor transaction mode) بالدور wa_ingest المحدود الاتصالات، بدلاً من PostgREST. بدون الفلاغ = سلوك v3 بالضبط.
// تحتاج verify_jwt = false (ميتا لا ترسل JWT)؛ الحماية بتوقيع X-Hub-Signature-256.
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3.4.5";
import { processPendingMedia } from "../_shared/wa-media.ts";
import { handleWebhook, type IngestArgs, type IngestResult, type Op } from "./handler.ts";

const FN: Record<Op["kind"], string> = {
  echo: "cm_ingest_whatsapp_echo", history: "cm_ingest_whatsapp_history", contacts: "cm_sync_whatsapp_contacts",
  status: "cm_update_whatsapp_status", log: "cm_log_whatsapp_webhook",
};
const INGEST_FN = "cm_ingest_whatsapp_message";
const DIRECT_TIMEOUT_MS = 8000;

// أخطاء تعني أن المسار المباشر "غير متاح" (لا يوجد ضغط أقفال): نرجع لـ PostgREST.
// التشبّع (53300 / timeout) لا يرجع لـ PostgREST عمداً حتى لا يُستهلك طابور التطبيق؛ يرد 500 وميتا تعيد الإرسال.
const FALLBACK_CODES = new Set(["ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "28P01", "28000", "3D000", "57P03", "XX000", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"]);
const isUnavailable = (e: unknown) => {
  const x = e as { code?: string; message?: string };
  return FALLBACK_CODES.has(String(x?.code ?? "")) || /tenant\/user .* not found|password authentication failed/i.test(String(x?.message ?? ""));
};

let sql: ReturnType<typeof postgres> | null = null;
// قاطع دائرة: بعد عطل اتصال صريح نتجاوز المسار المباشر 60 ثانية (لا ننتظر 8 ث في كل استدعاء).
let directDownUntil = 0;
const directEnabled = () => Deno.env.get("WA_DIRECT_DB") === "1" && !!Deno.env.get("WA_DB_PW") && Date.now() >= directDownUntil;
const markDown = () => {
  directDownUntil = Date.now() + 60_000;
  const old = sql; sql = null;
  old?.end({ timeout: 1 }).catch(() => {});
};
const getSql = () => {
  if (!sql) {
    const host = Deno.env.get("WA_DB_HOST") ?? "aws-1-eu-central-1.pooler.supabase.com";
    const ref = new URL(Deno.env.get("SUPABASE_URL")!).hostname.split(".")[0];
    sql = postgres({
      host, port: Number(Deno.env.get("WA_DB_PORT") ?? "6543"), database: "postgres",
      username: `wa_ingest.${ref}`, password: Deno.env.get("WA_DB_PW")!, ssl: "require",
      max: 2, prepare: false, connect_timeout: 5, idle_timeout: 20, onnotice: () => {},
    });
  }
  return sql;
};

const withTimeout = <T>(p: Promise<T>, ms: number) => new Promise<T>((res, rej) => {
  const t = setTimeout(() => rej(Object.assign(new Error("WA_DIRECT_TIMEOUT"), { code: "WA_DIRECT_TIMEOUT" })), ms);
  p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
});

// استدعاء دالة بالأسماء (named notation) مثل PostgREST؛ jsonb تُمرَّر كنص JSON مع ::text::jsonb (بدونه يعيد postgres.js ترميزها كسلسلة JSON).
const callDirect = async (fn: string, args: Record<string, unknown>) => {
  const keys = Object.keys(args).filter((k) => /^_[a-z_]+$/.test(k));
  const vals: unknown[] = []; const parts: string[] = [];
  keys.forEach((k, i) => {
    const v = args[k];
    if (v !== null && typeof v === "object" && !(v instanceof Date)) { vals.push(JSON.stringify(v)); parts.push(`${k} => $${i + 1}::text::jsonb`); }
    else { vals.push(v === undefined ? null : v); parts.push(`${k} => $${i + 1}`); }
  });
  const q = getSql().unsafe(`select public.${fn}(${parts.join(", ")}) as r`, vals as never[]);
  const rows = await withTimeout(q, DIRECT_TIMEOUT_MS);
  return (rows as unknown as Array<{ r: unknown }>)[0]?.r ?? null;
};

Deno.serve(async (req) => {
  const env = {
    META_APP_SECRET: Deno.env.get("META_APP_SECRET") ?? undefined,
    WHATSAPP_VERIFY_TOKEN: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? undefined,
  };
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // اختبار ذاتي محمي للمسار المباشر (لا يكتب شيئاً): POST + x-wa-selftest = WA_SELFTEST_TOKEN
  const st = req.headers.get("x-wa-selftest");
  if (st && Deno.env.get("WA_SELFTEST_TOKEN") && st === Deno.env.get("WA_SELFTEST_TOKEN")) {
    const t0 = performance.now();
    try {
      const r = await withTimeout(getSql()`select current_user u, current_setting('lock_timeout') lt,
        current_setting('statement_timeout') stt, pg_backend_pid() pid`, DIRECT_TIMEOUT_MS);
      return Response.json({ ok: true, flag: Deno.env.get("WA_DIRECT_DB") ?? null, ms: Math.round(performance.now() - t0), ...r[0] });
    } catch (e) {
      return Response.json({ ok: false, code: (e as { code?: string }).code ?? null, msg: String((e as Error).message).slice(0, 120) }, { status: 500 });
    }
  }

  const viaRest = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const call = async (fn: string, args: Record<string, unknown>) => {
    if (!directEnabled()) return viaRest(fn, args);
    try { return await callDirect(fn, args); }
    catch (e) {
      if (isUnavailable(e)) { markDown(); console.error("wa direct unavailable, fallback to rest", (e as { code?: string }).code ?? ""); return viaRest(fn, args); }
      throw e;
    }
  };
  const ingest = async (args: IngestArgs): Promise<IngestResult> =>
    (await call(INGEST_FN, args as unknown as Record<string, unknown>)) as IngestResult;
  const runOp = async (op: Op) => call(FN[op.kind], op.args as Record<string, unknown>);

  return handleWebhook(req, env, ingest, runOp).then((res) => {
    // تنزيل الوسائط في الخلفية بعد الرد (لا يبطئ الويبهوك)؛ كل استدعاء يعيد محاولة المعلّق أيضاً.
    if (req.method === "POST" && res.status === 200) {
      const job = processPendingMedia(db, Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? undefined, 5)
        .catch(() => undefined);
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(job);
    }
    return res;
  });
});
