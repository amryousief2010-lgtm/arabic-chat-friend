import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DirectoryEmployee } from "@/lib/hr/directory";

export interface HrLocation { id: string; name: string; department: string | null }

/** بيانات العرض فقط لشاشات الموارد البشرية — لا تُجلب المرتبات ولا الهواتف */
export const DIRECTORY_COLUMNS =
  "id, code, full_name, job_title, department, current_location_id, status, pay_day, user_id, photo_url, is_suspended, start_date";

export function useHrDirectory() {
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [locations, setLocations] = useState<HrLocation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [emp, loc] = await Promise.all([
        (supabase as any).from("hr_employees").select(DIRECTORY_COLUMNS).order("code"),
        supabase.from("hr_work_locations").select("id, name, department").order("sort_order"),
      ]);
      if (!alive) return;
      setEmployees((emp.data || []) as DirectoryEmployee[]);
      setLocations((loc.data || []) as HrLocation[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  return { employees, locations, loading };
}
