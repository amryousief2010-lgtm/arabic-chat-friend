import { supabase } from "@/integrations/supabase/client";

/**
 * For rows whose `moderator` is empty, fill it with the creator's profile
 * full_name (looked up by created_by in profile_directory). Rows that already
 * have a moderator are left untouched.
 */
export async function fillModeratorFromCreator<T extends { moderator: string | null; created_by?: string | null }>(
  rows: T[],
): Promise<T[]> {
  const ids = Array.from(
    new Set(rows.filter((r) => !(r.moderator || "").trim() && r.created_by).map((r) => r.created_by as string)),
  );
  if (ids.length === 0) return rows;
  const names: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from("profile_directory").select("id, full_name").in("id", ids.slice(i, i + 100));
    (data || []).forEach((p: any) => { if (p.full_name) names[p.id] = String(p.full_name).trim(); });
  }
  return rows.map((r) =>
    !(r.moderator || "").trim() && r.created_by && names[r.created_by]
      ? { ...r, moderator: names[r.created_by] }
      : r,
  );
}
