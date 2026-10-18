import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  APPROVED_OCT_2026_SCHEDULE,
  type MarginalSchedule,
  parseScheduleRow,
} from '@/lib/processedKgBonus';

export const PROCESSED_SCHEDULES_KEY = ['processed-kg-bonus-schedules'] as const;

export const useProcessedKgSchedules = () => {
  const query = useQuery({
    queryKey: PROCESSED_SCHEDULES_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('processed_kg_bonus_schedules')
        .select('id, effective_from, minimum_kg, bands')
        .order('effective_from', { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .map((row) => parseScheduleRow(row))
        .filter((row): row is MarginalSchedule => !!row);
    },
    staleTime: 30_000,
  });

  const schedules = query.data && query.data.length > 0
    ? query.data
    : [APPROVED_OCT_2026_SCHEDULE];

  return { ...query, schedules };
};
