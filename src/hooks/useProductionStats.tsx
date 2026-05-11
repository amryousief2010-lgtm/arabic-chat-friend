import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProductionStats {
  eggs: { today: number; month: number; year: number; range: number };
  chicks: { today: number; month: number; year: number; range: number };
  sales: {
    sold_today: number; sold_month: number; sold_year: number; sold_range: number;
    revenue_month: number; revenue_year: number; revenue_range: number;
  };
  daily: Array<{ date: string; eggs: number; chicks: number; sold: number; revenue: number }>;
  range: { from: string; to: string };
}

export const useProductionStats = (from?: string, to?: string) => {
  return useQuery({
    queryKey: ["production-stats", from || "default", to || "default"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_production_dashboard", {
        p_from: from || null,
        p_to: to || null,
      });
      if (error) throw error;
      return data as unknown as ProductionStats;
    },
    staleTime: 2 * 60 * 1000,
  });
};
