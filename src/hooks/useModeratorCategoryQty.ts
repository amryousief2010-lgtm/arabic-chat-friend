import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cairoMonthStartUTC } from '@/lib/cairoDate';
import { classifyPayrollProduct } from '@/lib/payrollProductCategories';
import { matchesModeratorGroup } from '@/constants/moderators';
import { applyClosureCutoff, usePayrollClosureCutoff } from '@/hooks/usePayrollClosure';
import type { PayrollQty } from '@/lib/moderatorPayrollMath';

export const fetchModeratorCategoryQty = async (args: {
  year: number;
  month: number;
  girls: string[];
  cutoff: string | null;
}): Promise<PayrollQty> => {
  const { year, month, girls, cutoff } = args;
  const startDate = cairoMonthStartUTC(year, month - 1).toISOString();
  const endDate = cairoMonthStartUTC(year, month).toISOString();
  const empty = () => girls.reduce((acc, girl) => {
    acc[girl] = 0;
    return acc;
  }, {} as Record<string, number>);
  const result: PayrollQty = { meat: empty(), bone: empty(), processed: empty() };

  const PAGE_ORDERS = 1000;
  const orders: Array<{ id: string; moderator: string | null; created_by: string | null }> = [];
  let offset = 0;
  while (true) {
    const baseQ = supabase
      .from('orders')
      .select('id, moderator, created_by')
      .eq('status', 'delivered')
      .gte('created_at', startDate)
      .lt('created_at', endDate);
    const { data: chunk, error } = await applyClosureCutoff(baseQ, cutoff)
      .range(offset, offset + PAGE_ORDERS - 1);
    if (error) throw error;
    if (!chunk || chunk.length === 0) break;
    orders.push(...chunk);
    if (chunk.length < PAGE_ORDERS) break;
    offset += PAGE_ORDERS;
  }
  if (orders.length === 0) return result;

  const userIds = Array.from(new Set(orders.map((order) => order.created_by).filter(Boolean))) as string[];
  let profileMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase.from('profile_directory').select('id, full_name').in('id', userIds);
    profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
  }

  const orderToGirl = new Map<string, string>();
  orders.forEach((order) => {
    const modName = order.moderator || '';
    const creatorName = order.created_by ? (profileMap.get(order.created_by) || '') : '';
    const girl = girls.find((key) => matchesModeratorGroup(modName, key) || matchesModeratorGroup(creatorName, key));
    if (girl) orderToGirl.set(order.id, girl);
  });

  const orderIds = Array.from(orderToGirl.keys());
  if (orderIds.length === 0) return result;

  const ID_CHUNK = 200;
  const PAGE = 1000;
  const allItems: Array<{ order_id: string; product_name: string | null; quantity: number | null }> = [];
  for (let i = 0; i < orderIds.length; i += ID_CHUNK) {
    const chunk = orderIds.slice(i, i + ID_CHUNK);
    let from = 0;
    while (true) {
      const { data: items, error: itemsError } = await supabase
        .from('order_items')
        .select('order_id, product_name, quantity')
        .in('order_id', chunk)
        .range(from, from + PAGE - 1);
      if (itemsError) throw itemsError;
      if (!items || items.length === 0) break;
      allItems.push(...items);
      if (items.length < PAGE) break;
      from += PAGE;
    }
  }

  allItems.forEach((item) => {
    const girl = orderToGirl.get(item.order_id);
    if (!girl) return;
    const category = classifyPayrollProduct(item.product_name || '');
    const quantity = Number(item.quantity) || 0;
    if (category === 'bone') result.bone[girl] += quantity;
    else if (category === 'processed') result.processed[girl] += quantity;
    else if (category === 'meat') result.meat[girl] += quantity;
  });
  return result;
};

export const useModeratorCategoryQty = (year: number, month: number, girls: string[]) => {
  const queryClient = useQueryClient();
  const { cutoff } = usePayrollClosureCutoff(year, month);
  const girlsKey = girls.join('|');

  const query = useQuery({
    queryKey: ['girls-auto-qty', month, year, cutoff, girlsKey],
    queryFn: () => fetchModeratorCategoryQty({ year, month, girls, cutoff }),
    refetchInterval: 60000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`moderator-qty-${month}-${year}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-auto-qty'] });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chick_orders' }, () => {
        queryClient.invalidateQueries({ queryKey: ['girls-chick-qty'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient, month, year]);

  return query;
};
