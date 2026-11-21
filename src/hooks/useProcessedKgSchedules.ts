import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  APPROVED_OCT_2026_SCHEDULE,
  type MarginalSchedule,
  parseScheduleRow,
} from '@/lib/processedKgBonus';
import { canReadBonusSettingsTable } from '@/lib/risingBonusTableAccess';

export const PROCESSED_SCHEDULES_KEY = ['processed-kg-bonus-schedules'] as const;

export const useProcessedKgSchedules = () => {
  const { roles, loading } = useAuth();
  const canRead = canReadBonusSettingsTable(roles);
  const query = useQuery({
    queryKey: PROCESSED_SCHEDULES_KEY,
    enabled: !loading && canRead,
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
