import { supabase } from '@/integrations/supabase/client';
import { matchesModeratorGroup } from '@/constants/moderators';
import { cairoMonthStartUTC } from '@/lib/cairoDate';
import { classifyPayrollProduct } from '@/lib/payrollProductCategories';

export interface PayrollClosureRef {
  year: number;
  month: number;
  approved_at: string;
}

export interface CarriedOrderQty {
  orderId: string;
  orderNumber: string;
  girl: string;
  deliveredAt: string;
  originYear: number;
  originMonth: number;
  closureApprovedAt: string;
  meatKg: number;
  boneKg: number;
  procKg: number;
}

/** نفس منطق ترحيل بونص الأوردرات التي سُلّمت بعد اعتماد شهرها. */
export const fetchPayrollCarried = async (
  year: number,
  month: number,
  girls: string[],
  closures: PayrollClosureRef[],
): Promise<CarriedOrderQty[]> => {
  const idxOf = (y: number, m: number) => y * 12 + (m - 1);
  const selIdx = idxOf(year, month);
  const closureAtIdx = (i: number) => {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    return closures.find((closure) => closure.year === y && closure.month === m) || null;
  };
  const payingIdx = (originIdx: number, deliveredAt: string) => {
    for (let i = originIdx + 1; i <= selIdx; i++) {
      const closure = closureAtIdx(i);
      if (!closure || new Date(closure.approved_at).getTime() > new Date(deliveredAt).getTime()) return i;
    }
    return -1;
  };

  const out: Array<Omit<CarriedOrderQty, 'meatKg' | 'boneKg' | 'procKg'>> = [];
  for (const closure of closures) {
    const originIdx = idxOf(closure.year, closure.month);
    if (originIdx >= selIdx) continue;
    const start = cairoMonthStartUTC(closure.year, closure.month - 1).toISOString();
    const end = cairoMonthStartUTC(closure.year, closure.month).toISOString();
    const { data: rows, error } = await supabase
      .from('orders')
      .select('id, order_number, moderator, created_by, delivered_at')
      .eq('status', 'delivered')
      .gte('created_at', start)
      .lt('created_at', end)
      .gt('delivered_at', closure.approved_at);
    if (error) throw error;
    const candidates = (rows || []).filter((order) => order.delivered_at && payingIdx(originIdx, order.delivered_at) === selIdx);
    if (candidates.length === 0) continue;

    const userIds = Array.from(new Set(candidates.map((order) => order.created_by).filter(Boolean))) as string[];
    let profileMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profile_directory').select('id, full_name').in('id', userIds);
      profileMap = new Map((profiles || []).map((profile) => [profile.id, profile.full_name]));
    }
    candidates.forEach((order) => {
      const modName = order.moderator || '';
      const creatorName = order.created_by ? (profileMap.get(order.created_by) || '') : '';
      const girl = girls.find((key) => matchesModeratorGroup(modName, key) || matchesModeratorGroup(creatorName, key));
      if (!girl) return;
      out.push({
        orderId: order.id,
        orderNumber: order.order_number || '',
        girl,
        deliveredAt: order.delivered_at as string,
        originYear: closure.year,
        originMonth: closure.month,
        closureApprovedAt: closure.approved_at,
      });
    });
  }

  if (out.length === 0) return [];
  const byId = new Map(out.map((order) => [order.orderId, { ...order, meatKg: 0, boneKg: 0, procKg: 0 }]));
  const ids = Array.from(byId.keys());
  const ID_CHUNK = 200;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { data: items, error } = await supabase
      .from('order_items')
      .select('order_id, product_name, quantity')
      .in('order_id', chunk);
    if (error) throw error;
    (items || []).forEach((item) => {
      const rec = byId.get(item.order_id);
      if (!rec) return;
      const quantity = Number(item.quantity) || 0;
      const category = classifyPayrollProduct(item.product_name || '');
      if (category === 'bone') rec.boneKg += quantity;
      else if (category === 'processed') rec.procKg += quantity;
      else if (category === 'meat') rec.meatKg += quantity;
    });
  }
  return Array.from(byId.values());
};
