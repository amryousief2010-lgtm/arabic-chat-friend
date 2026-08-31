import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { useQueryClient } from '@tanstack/react-query';

const managerRoles = ['general_manager', 'executive_manager', 'sales_manager'];

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

/**
 * In-app order notifications.
 *
 * Notification rows are now created by the database trigger
 * `trg_notify_order_lifecycle_*`, so the client only listens and surfaces them
 * (toast + sound). RLS makes sure each user only receives the rows they may see,
 * which also removes the duplicate inserts we had when several managers were
 * online at the same time.
 */
export const useOrderNotifications = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { settings } = useNotificationSettings();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel('order-notifications-inapp')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => {
          const row = payload.new as {
            title: string;
            description: string;
            type: string | null;
            order_id: string | null;
          };

          if (row.type !== 'new_order' && row.type !== 'status_update') return;

          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });

          if (settings.soundEnabled) playNotificationSound();

          toast({ title: row.title, description: row.description });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, toast, settings.soundEnabled, queryClient]);
};

