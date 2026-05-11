import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Package, CheckCircle2, XCircle } from 'lucide-react';

const GIRLS = ['اية', 'نورا', 'سارة', 'منال'];

interface OrderRow {
  status: string;
  moderator: string | null;
  created_by: string | null;
}

interface ProfileRow {
  id: string;
  full_name: string;
}

const matches = (name: string, target: string) => {
  if (!name) return false;
  const n = name.trim();
  // normalize alef variants
  const normalize = (s: string) => s.replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  return normalize(n).includes(normalize(target));
};

const ModeratorOrdersBreakdown = () => {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['moderator-orders-breakdown'],
    refetchInterval: 60000,
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('status, moderator, created_by');
      if (error) throw error;

      const userIds = Array.from(new Set((orders || []).map(o => o.created_by).filter(Boolean))) as string[];
      let profiles: ProfileRow[] = [];
      if (userIds.length > 0) {
        const { data: pData } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        profiles = (pData || []) as ProfileRow[];
      }

      const profileMap = new Map(profiles.map(p => [p.id, p.full_name]));

      return GIRLS.map(girl => {
        const filtered = (orders as OrderRow[]).filter(o => {
          const modName = o.moderator || '';
          const creatorName = o.created_by ? (profileMap.get(o.created_by) || '') : '';
          return matches(modName, girl) || matches(creatorName, girl);
        });
        const total = filtered.length;
        const delivered = filtered.filter(o => o.status === 'delivered').length;
        const cancelled = filtered.filter(o => o.status === 'cancelled').length;
        return { name: girl, total, delivered, cancelled };
      });
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('moderator-orders-breakdown')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['moderator-orders-breakdown'] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          تقسيم مبيعات المسوقات
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-center text-muted-foreground py-8">جاري التحميل...</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(data || []).map(item => (
              <Card key={item.name} className="border-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg text-center">{item.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-primary/5">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" />
                      <span className="text-sm">عدد الأوردرات</span>
                    </div>
                    <span className="font-bold text-lg">{item.total}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-green-500/10">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm">تم التسليم</span>
                    </div>
                    <span className="font-bold text-lg text-green-600">{item.delivered}</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-lg bg-red-500/10">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm">ملغية</span>
                    </div>
                    <span className="font-bold text-lg text-red-600">{item.cancelled}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default ModeratorOrdersBreakdown;
