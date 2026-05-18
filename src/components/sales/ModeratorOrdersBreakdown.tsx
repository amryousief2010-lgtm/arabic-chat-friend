import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Users, Package, CheckCircle2, XCircle, Truck, RefreshCw } from 'lucide-react';

const GIRLS = ['اية', 'نورا', 'سارة', 'منال'];

const months = [
  { value: 1, label: 'يناير' },
  { value: 2, label: 'فبراير' },
  { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' },
  { value: 5, label: 'مايو' },
  { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' },
  { value: 8, label: 'أغسطس' },
  { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' },
  { value: 11, label: 'نوفمبر' },
  { value: 12, label: 'ديسمبر' },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

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
  const normalize = (s: string) => s.replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  return normalize(name.trim()).includes(normalize(target));
};

const ModeratorOrdersBreakdown = () => {
  const queryClient = useQueryClient();
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data, isLoading } = useQuery({
    queryKey: ['moderator-orders-breakdown', selectedMonth, selectedYear],
    refetchInterval: 60000,
    queryFn: async () => {
      // حدود الشهر بـ UTC لتطابق طريقة تخزين created_at للأوردرات المستوردة
      const startDate = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1, 0, 0, 0, 0)).toISOString();
      const endDate = new Date(Date.UTC(selectedYear, selectedMonth, 1, 0, 0, 0, 0)).toISOString();

      const { data: orders, error } = await supabase
        .from('orders')
        .select('status, moderator, created_by')
        .gte('created_at', startDate)
        .lt('created_at', endDate);
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
        const pending = total - delivered - cancelled;
        return { name: girl, total, delivered, cancelled, pending };
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
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            تقسيم مبيعات المسوقات - {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map(m => (
                  <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number(v))}>
              <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map(y => (
                  <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
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
                  <div className="flex items-center justify-between p-2 rounded-lg bg-amber-500/10">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-amber-600" />
                      <span className="text-sm">قيد التوصيل</span>
                    </div>
                    <span className="font-bold text-lg text-amber-600">{item.pending}</span>
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
