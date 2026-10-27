import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DirectoryEmployee } from "@/lib/hr/directory";

export interface HrLocation { id: string; name: string; department: string | null }

/** بيانات العرض فقط لشاشات الموارد البشرية — لا تُجلب المرتبات ولا الهواتف */
export const DIRECTORY_COLUMNS =
  "id, code, full_name, job_title, department, current_location_id, status, pay_day, user_id, photo_url, is_suspended, start_date";

/**
 * source = "public": لغير مسؤولي الموارد البشرية — يقرأ من الدالة الآمنة hr_avatar_directory()
 * (الاسم والمسمى والقسم والحالة والصورة فقط).
 */
export function useHrDirectory(opts: { source?: "table" | "public" } = {}) {
  const source = opts.source || "table";
  const [unavailable, setUnavailable] = useState(false);
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [locations, setLocations] = useState<HrLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [emp, loc] = await Promise.all([
        source === "public"
          ? (supabase as any).rpc("hr_avatar_directory")
          : (supabase as any).from("hr_employees").select(DIRECTORY_COLUMNS).order("code"),
        supabase.from("hr_work_locations").select("id, name, department").order("sort_order"),
      ]);
      if (!alive) return;
      if (source === "public" && emp.error) setUnavailable(true);
      const rows = (emp.data || []).map((r: any) => ({ code: "", current_location_id: null, pay_day: 0, ...r }));
      setEmployees(rows as DirectoryEmployee[]);
      setLocations((loc.data || []) as HrLocation[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [source]);

  return { employees, locations, loading, unavailable };
}
