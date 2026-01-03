import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

const statusLabels: Record<string, string> = {
  pending: 'قيد الانتظار',
  processing: 'قيد التجهيز',
  ready: 'جاهز للتسليم',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

export const useOrderNotifications = () => {
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;

    console.log('Setting up order notifications...');

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          console.log('New order created:', payload);
          const newOrder = payload.new as { order_number: string; total: number };
          toast({
            title: '🆕 طلب جديد',
            description: `تم إنشاء الطلب ${newOrder.order_number} بقيمة ${newOrder.total} ر.س`,
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          console.log('Order updated:', payload);
          const oldOrder = payload.old as { status: string };
          const updatedOrder = payload.new as { order_number: string; status: string };
          
          if (oldOrder.status !== updatedOrder.status) {
            const newStatusLabel = statusLabels[updatedOrder.status] || updatedOrder.status;
            toast({
              title: '📦 تحديث حالة الطلب',
              description: `الطلب ${updatedOrder.order_number} أصبح: ${newStatusLabel}`,
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('Subscription status:', status);
      });

    return () => {
      console.log('Cleaning up order notifications...');
      supabase.removeChannel(channel);
    };
  }, [user, toast]);
};
