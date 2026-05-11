import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

const today = () => format(new Date(), "yyyy-MM-dd");
const monthStart = () => { const d = new Date(); d.setDate(1); return format(d, "yyyy-MM-dd"); };
const yearStart = () => `${new Date().getFullYear()}-01-01`;

export const useProductionStats = () => {
  return useQuery({
    queryKey: ["production-stats"],
    queryFn: async () => {
      const t = today(), ms = monthStart(), ys = yearStart();

      // Eggs production
      const { data: eggs } = await supabase
        .from("farm_egg_production")
        .select("production_date, egg_count")
        .gte("production_date", ys);

      const eggsToday = (eggs || []).filter(e => e.production_date === t).reduce((s, e) => s + (e.egg_count || 0), 0);
      const eggsMonth = (eggs || []).filter(e => e.production_date >= ms).reduce((s, e) => s + (e.egg_count || 0), 0);
      const eggsYear = (eggs || []).reduce((s, e) => s + (e.egg_count || 0), 0);

      // Chicks production from hatch_batches (by exit_date)
      const { data: batches } = await supabase
        .from("hatch_batches")
        .select("exit_date, hatched_chicks")
        .gte("exit_date", ys);

      const chicksToday = (batches || []).filter(b => b.exit_date === t).reduce((s, b) => s + (b.hatched_chicks || 0), 0);
      const chicksMonth = (batches || []).filter(b => b.exit_date && b.exit_date >= ms).reduce((s, b) => s + (b.hatched_chicks || 0), 0);
      const chicksYear = (batches || []).reduce((s, b) => s + (b.hatched_chicks || 0), 0);

      // Chick sales
      const { data: moves } = await supabase
        .from("chick_movements")
        .select("movement_date, sold, unit_price")
        .gte("movement_date", ys);

      const sold = (filterFn: (m: any) => boolean) => (moves || []).filter(filterFn).reduce((s, m) => s + (m.sold || 0), 0);
      const revenue = (filterFn: (m: any) => boolean) => (moves || []).filter(filterFn).reduce((s, m) => s + ((m.sold || 0) * Number(m.unit_price || 0)), 0);

      const soldToday = sold(m => m.movement_date === t);
      const soldMonth = sold(m => m.movement_date >= ms);
      const soldYear = sold(() => true);
      const revenueMonth = revenue(m => m.movement_date >= ms);
      const revenueYear = revenue(() => true);

      return {
        eggsToday, eggsMonth, eggsYear,
        chicksToday, chicksMonth, chicksYear,
        soldToday, soldMonth, soldYear,
        revenueMonth, revenueYear,
      };
    },
    staleTime: 2 * 60 * 1000,
  });
};
