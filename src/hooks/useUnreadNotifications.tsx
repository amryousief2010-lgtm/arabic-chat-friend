import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

let unreadCountCache = 0;
let activeSubscribers = 0;
let fetchInFlight: Promise<void> | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

const listeners = new Set<(count: number) => void>();

const notifyListeners = (count: number) => {
  unreadCountCache = count;
  listeners.forEach((listener) => listener(count));
};

const fetchUnreadCount = async () => {
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('is_read', false);

    if (!error && count !== null) {
      notifyListeners(count);
    }
  })();

  try {
    await fetchInFlight;
  } finally {
    fetchInFlight = null;
  }
};

const ensureRealtimeSubscription = () => {
  if (realtimeChannel) return;

  realtimeChannel = supabase
    .channel('unread-notifications')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
      },
      () => {
        void fetchUnreadCount();
      }
    )
    .subscribe();
};

const cleanupRealtimeSubscription = () => {
  if (!realtimeChannel || activeSubscribers > 0) return;

  void supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
};

export const useUnreadNotifications = () => {
  const [unreadCount, setUnreadCount] = useState(unreadCountCache);

  useEffect(() => {
    activeSubscribers += 1;
    listeners.add(setUnreadCount);
    setUnreadCount(unreadCountCache);

    void fetchUnreadCount();
    ensureRealtimeSubscription();

    return () => {
      listeners.delete(setUnreadCount);
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      cleanupRealtimeSubscription();
    };
  }, []);

  return { unreadCount, refetch: fetchUnreadCount };
};
