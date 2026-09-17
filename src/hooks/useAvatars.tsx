import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * صور المستخدمين الشخصية.
 * الصور مخزّنة في bucket خاص (avatars)، لذلك نجلب روابط موقّعة دفعة واحدة
 * لكل المستخدمين ونحتفظ بها في ذاكرة مشتركة بين كل الشاشات.
 */

type Entry = { path: string | null; url: string | null };

let store: Record<string, Entry> = {};
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

    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from("avatars")
        .createSignedUrls(paths, 60 * 60);
      const map = new Map<string, string>();
      (signed || []).forEach((s: any) => {
        if (s?.path && s?.signedUrl) map.set(s.path, s.signedUrl);
      });
      Object.values(next).forEach((e) => {
        if (e.path) e.url = map.get(e.path) ?? null;
      });
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
export function useAvatarUrl(userId?: string | null): string | null {
  const [, force] = useState(0);

  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    ensureLoaded();
    return () => {
      listeners.delete(l);
    };
  }, []);

  if (!userId) return null;
  return store[userId]?.url ?? null;
}
