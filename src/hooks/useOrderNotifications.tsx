import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';

const statusLabels: Record<string, string> = {
  pending: 'قيد الانتظار',
  processing: 'قيد التجهيز',
  ready: 'جاهز للتسليم',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

// Create notification sound using Web Audio API
const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.1);
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime + 0.2);
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.4);
  } catch (error) {
    console.log('Could not play notification sound:', error);
  }
};

export const useOrderNotifications = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { settings } = useNotificationSettings();

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
        async (payload) => {
          console.log('New order created:', payload);
          const newOrder = payload.new as { id: string; order_number: string; total: number };
          
          const title = '🆕 طلب جديد';
          const description = `تم إنشاء الطلب ${newOrder.order_number} بقيمة ${newOrder.total} ر.س`;
          
          // Save notification to database
          await supabase.from('notifications').insert({
            title,
            description,
            type: 'new_order',
            order_id: newOrder.id,
          });
          
          // Play notification sound if enabled
          if (settings.soundEnabled) {
            playNotificationSound();
          }
          
          toast({ title, description });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
        },
        async (payload) => {
          console.log('Order updated:', payload);
          const oldOrder = payload.old as { status: string };
          const updatedOrder = payload.new as { id: string; order_number: string; status: string };
          
          if (oldOrder.status !== updatedOrder.status) {
            const newStatusLabel = statusLabels[updatedOrder.status] || updatedOrder.status;
            const title = '📦 تحديث حالة الطلب';
            const description = `الطلب ${updatedOrder.order_number} أصبح: ${newStatusLabel}`;
            
            // Save notification to database
            await supabase.from('notifications').insert({
              title,
              description,
              type: 'status_update',
              order_id: updatedOrder.id,
            });
            
            toast({ title, description });
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
