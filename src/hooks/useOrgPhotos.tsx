import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * صور الأشخاص للهيكل التنظيمي — تُجمع من صور المستخدمين (profile_directory)
 * وصور الموظفين (hr_employees)، وتُطابق بالاسم بعد التطبيع.
 */

export const normalizeName = (raw: string) =>
  (raw || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/^(م|أ|ا|د|ح|ك)\s*\/\s*/, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (raw: string) => normalizeName(raw).split(" ").filter(Boolean);

type Person = { name: string; path: string };

export function useOrgPhotos() {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dir, emp] = await Promise.all([
          (supabase as any).from("profile_directory").select("full_name, avatar_url"),
          (supabase as any).from("hr_employees").select("full_name, photo_url"),
        ]);

        const people: Person[] = [];
        (dir.data || []).forEach((p: any) => {
          if (p.avatar_url && p.full_name) people.push({ name: p.full_name, path: p.avatar_url });
        });
        (emp.data || []).forEach((p: any) => {
          if (p.photo_url && p.full_name) people.push({ name: p.full_name, path: p.photo_url });
        });
        if (!people.length) return;

        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrls(Array.from(new Set(people.map((p) => p.path))), 60 * 60);
        const byPath = new Map<string, string>();
        (signed || []).forEach((s: any) => {
          if (s?.path && s?.signedUrl) byPath.set(s.path, s.signedUrl);
        });

        const map: Record<string, string> = {};
        people.forEach((p) => {
          const url = byPath.get(p.path);
          if (url) map[normalizeName(p.name)] = url;
        });
        if (!cancelled) setUrls(map);
      } catch {
        /* تجاهل — الهيكل يعمل بدون صور */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** إيجاد صورة لاسم مكتوب في الهيكل (مطابقة كاملة أو بكل كلمات الاسم) */
  const getPhoto = (name: string): string | null => {
    const key = normalizeName(name);
    if (!key) return null;
    if (urls[key]) return urls[key];
    const t = tokens(name);
    if (t.length < 2) return null;
    const hit = Object.keys(urls).find((k) => {
      const kt = k.split(" ");
      return t.every((x) => kt.includes(x));
    });
    return hit ? urls[hit] : null;
  };

  return { getPhoto };
}
