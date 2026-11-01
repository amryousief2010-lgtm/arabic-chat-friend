import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * صور المستخدمين الشخصية.
 * الصور مخزّنة في bucket خاص (avatars)، لذلك نجلب روابط موقّعة دفعة واحدة
 * لكل المستخدمين ونحتفظ بها في ذاكرة مشتركة بين كل الشاشات.
 */

type Entry = { path: string | null; url: string | null };

let store: Record<string, Entry> = {};
/** صور الموظفين حسب معرّف الموظف (مصدر احتياطي حين لا يوجد حساب مربوط أو صورة حساب) */
let employeeStore: Record<string, { userId: string | null; url: string | null }> = {};
/** الاسم (بعد التطبيع) ← معرّف الحساب — لعقد بلا معرّف مثل القيادة وكروت المسوقات */
let nameStore: Record<string, string> = {};
let loadPromise: Promise<void> | null = null;
let loadedAt = 0;
const TTL = 45 * 60 * 1000; // الرابط الموقّع صالح ساعة

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** تطبيع الاسم العربي للمطابقة: يحذف الألقاب ويوحّد الألف والياء والتاء المربوطة */
export function normalizeArabicName(name?: string | null): string {
  return (name || "")
    .replace(/^\s*(أ|م|د|ا)\s*\.\s*/u, "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

const withTimeout = <T,>(p: PromiseLike<T>, ms = 15000): Promise<T> =>
  Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** يوقّع الروابط على دفعات؛ فشل دفعة لا يُسقط الباقي */
export async function signAvatarPaths(paths: string[], sign: (chunk: string[]) => PromiseLike<{ data: any[] | null; error: any }>, size = 50) {
  const map = new Map<string, string>();
  const unique = Array.from(new Set(paths));
  for (let i = 0; i < unique.length; i += size) {
    try {
      const { data } = await withTimeout(sign(unique.slice(i, i + size)));
      (data || []).forEach((s: any) => { if (s?.path && s?.signedUrl) map.set(s.path, s.signedUrl); });
    } catch { /* دفعة فاشلة */ }
  }
  return map;
}

async function load(): Promise<void> {
  let ok = false;
  try {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) return; // قبل تسجيل الدخول: لا نخزّن نتيجة فارغة
    const { data, error: pdErr } = await withTimeout((supabase as any)
      .from("profile_directory")
      .select("id, full_name, avatar_url")) as any;
    if (pdErr) throw pdErr;
    const names: Record<string, string> = {};
    (data || []).forEach((p: any) => {
      const k = normalizeArabicName(p.full_name);
      if (k && (!names[k] || p.avatar_url)) names[k] = p.id;
    });
    nameStore = names;

    const next: Record<string, Entry> = {};
    const paths: string[] = [];
    (data || []).forEach((p: any) => {
      const path = (p.avatar_url as string | null) || null;
      next[p.id as string] = { path, url: null };
      if (path) paths.push(path);
    });

    // مصدر واحد للصورة: صورة الحساب أولًا، ثم صورة ملف الموظف المربوط بالحساب.
    // قد لا يملك المستخدم صلاحية قراءة hr_employees — عندها نكتفي بصور الحسابات.
    const empPaths: Record<string, { userId: string | null; path: string | null }> = {};
    try {
      // دالة آمنة تعرض حقول الصورة فقط لكل مستخدم مسجّل؛ وإن لم تكن موجودة بعد نرجع للجدول.
      let { data: emps, error: rpcErr } = await withTimeout((supabase as any).rpc("hr_avatar_directory")) as any;
      if (rpcErr) {
        ({ data: emps } = await (supabase as any)
          .from("hr_employees")
          .select("id, user_id, photo_url"));
      }
      (emps || []).forEach((e: any) => {
        const userId = (e.user_id as string | null) || null;
        const path = (e.photo_url as string | null) || null;
        empPaths[e.id as string] = { userId, path };
        if (userId && path && !next[userId]?.path) {
          next[userId] = { path, url: null };
        }
        if (path) paths.push(path);
      });
    } catch {
      /* بدون صلاحية HR */
    }

    if (paths.length) {
      const map = await signAvatarPaths(paths, (chunk) => supabase.storage.from("avatars").createSignedUrls(chunk, 60 * 60) as any);
      Object.values(next).forEach((e) => {
        if (e.path) e.url = map.get(e.path) ?? null;
      });
      const nextEmp: typeof employeeStore = {};
      Object.entries(empPaths).forEach(([id, e]) => {
        nextEmp[id] = { userId: e.userId, url: e.path ? map.get(e.path) ?? null : null };
      });
      employeeStore = nextEmp;
    } else {
      employeeStore = Object.fromEntries(
        Object.entries(empPaths).map(([id, e]) => [id, { userId: e.userId, url: null }]),
      );
    }

    store = next;
    ok = true;
  } catch {
    /* نعيد المحاولة في الطلب التالي بدل تخزين نتيجة فارغة 45 دقيقة */
  } finally {
    loadedAt = ok ? Date.now() : 0;
    if (!ok) loadPromise = null;
    notify();
  }
}

function ensureLoaded() {
  if (!loadPromise || Date.now() - loadedAt > TTL) {
    loadPromise = load();
  }
  return loadPromise;
}

// عند تسجيل الدخول أو تجديد الجلسة نعيد التحميل
try {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") setTimeout(() => { loadPromise = load(); }, 0);
  });
} catch { /* بيئة اختبار */ }

/** إعادة تحميل الصور بعد رفع صورة جديدة */
export function refreshAvatars() {
  loadPromise = load();
  return loadPromise;
}

/** رابط الصورة الشخصية لمستخدم معيّن (أو null) */
export function resolveAvatarUrl(userId?: string | null, employeeId?: string | null, matchNames?: Array<string | null | undefined>): string | null {
  if (userId && store[userId]?.url) return store[userId].url;
  if (employeeId) {
    const e = employeeStore[employeeId];
    if (e?.userId && store[e.userId]?.url) return store[e.userId].url;
    if (e?.url) return e.url;
  }
  for (const n of matchNames || []) {
    const uid = nameStore[normalizeArabicName(n)];
    if (uid && store[uid]?.url) return store[uid].url;
  }
  return null;
}

/** للاختبارات فقط */
export function __setAvatarStoresForTest(s: { store?: typeof store; employeeStore?: typeof employeeStore; nameStore?: typeof nameStore }) {
  if (s.store) store = s.store;
  if (s.employeeStore) employeeStore = s.employeeStore;
  if (s.nameStore) nameStore = s.nameStore;
}

export function useAvatarUrl(userId?: string | null, employeeId?: string | null, matchNames?: Array<string | null | undefined>): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, []);

  return resolveAvatarUrl(userId, employeeId, matchNames);
}
