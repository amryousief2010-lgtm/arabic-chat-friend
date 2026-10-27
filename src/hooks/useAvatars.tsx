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
let loadPromise: Promise<void> | null = null;
let loadedAt = 0;
const TTL = 45 * 60 * 1000; // الرابط الموقّع صالح ساعة

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function load(): Promise<void> {
  try {
    const { data } = await (supabase as any)
      .from("profile_directory")
      .select("id, avatar_url");

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
      let { data: emps, error: rpcErr } = await (supabase as any).rpc("hr_avatar_directory");
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
      const { data: signed } = await supabase.storage
        .from("avatars")
        .createSignedUrls(Array.from(new Set(paths)), 60 * 60);
      const map = new Map<string, string>();
      (signed || []).forEach((s: any) => {
        if (s?.path && s?.signedUrl) map.set(s.path, s.signedUrl);
      });
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
    loadedAt = Date.now();
  } catch {
    loadedAt = Date.now();
  } finally {
    notify();
  }
}

function ensureLoaded() {
  if (!loadPromise || Date.now() - loadedAt > TTL) {
    loadPromise = load();
  }
  return loadPromise;
}

/** إعادة تحميل الصور بعد رفع صورة جديدة */
export function refreshAvatars() {
  loadPromise = load();
  return loadPromise;
}

/** رابط الصورة الشخصية لمستخدم معيّن (أو null) */
export function resolveAvatarUrl(userId?: string | null, employeeId?: string | null): string | null {
  if (userId && store[userId]?.url) return store[userId].url;
  if (employeeId) {
    const e = employeeStore[employeeId];
    if (e?.userId && store[e.userId]?.url) return store[e.userId].url;
    if (e?.url) return e.url;
  }
  return null;
}

export function useAvatarUrl(userId?: string | null, employeeId?: string | null): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, []);

  return resolveAvatarUrl(userId, employeeId);
}
