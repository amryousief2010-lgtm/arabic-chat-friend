import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const BADGE_REFETCH_MS = 2000;

// Keep in sync with src/pages/Notifications.tsx requiresImmediateReply().
const INFORMATIONAL_TYPES = new Set(['low_stock', 'production_needed']);
const ALWAYS_URGENT_TYPES = new Set(['farm_shipment', 'farm_shipment_receipt']);

const isUrgent = (n: { type?: string | null; order_id?: string | null }) =>
  ALWAYS_URGENT_TYPES.has(n.type ?? '') ||
  (!!n.order_id && !INFORMATIONAL_TYPES.has(n.type ?? ''));

interface UnreadState {
  unreadCount: number;
  urgentUnreadCount: number;
  lastUrgentAt: number; // timestamp of latest urgent arrival, for ring/flash triggers
}

let cache: UnreadState = { unreadCount: 0, urgentUnreadCount: 0, lastUrgentAt: 0 };
let activeSubscribers = 0;
let fetchInFlight: Promise<void> | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let subscribedUid: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<(s: UnreadState) => void>();

const notifyListeners = (next: UnreadState) => {
  cache = next;
  listeners.forEach((l) => l(next));
};

// Short ring + repeat for urgent alerts.
const playUrgentSound = () => {
  try {
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [0, 0.22, 0.44].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1040, now + offset);
      osc.frequency.exponentialRampToValueAtTime(760, now + offset + 0.18);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.2);
      osc.start(now + offset);
      osc.stop(now + offset + 0.22);
    });
  } catch (e) {
    // ignore audio errors silently
  }
};

const fetchUnreadCount = async () => {
  if (fetchInFlight) return fetchInFlight;

  fetchInFlight = (async () => {
    const { data, error } = await supabase.rpc('get_notification_badge_counts');
    const row = data?.[0];
    if (!error && row) {
      const urgent =
        Number(row.always_urgent_count || 0) +
        Number(row.order_urgent_typed_count || 0) +
        Number(row.order_urgent_null_type_count || 0);

      notifyListeners({
        unreadCount: Number(row.unread_count || 0),
        urgentUnreadCount: urgent,
        lastUrgentAt: cache.lastUrgentAt,
      });
    }
  })();

  try {
    await fetchInFlight;
  } finally {
    fetchInFlight = null;
  }
};

const scheduleUnreadRefresh = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void fetchUnreadCount();
  }, BADGE_REFETCH_MS);
};

const ensureRealtimeSubscription = (uid: string) => {
  if (realtimeChannel && subscribedUid === uid) return;
  if (realtimeChannel) {
    void supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  subscribedUid = uid;
  const filter = `target_user_id=eq.${uid}`;

  realtimeChannel = supabase
    .channel(`unread-notifications-${uid}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter },
      (payload) => {
        const row = payload.new as { is_read?: boolean; type?: string; order_id?: string | null };
        if (!row.is_read && isUrgent(row)) {
          cache = { ...cache, lastUrgentAt: Date.now() };
          notifyListeners(cache);
          playUrgentSound();
        }
        scheduleUnreadRefresh();
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications', filter },
      () => { scheduleUnreadRefresh(); }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'notifications', filter },
      () => { scheduleUnreadRefresh(); }
    )
    .subscribe();
};

const cleanupRealtimeSubscription = () => {
  if (!realtimeChannel || activeSubscribers > 0) return;
  void supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
  subscribedUid = null;
};

export const useUnreadNotifications = () => {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [state, setState] = useState<UnreadState>(cache);

  useEffect(() => {
    activeSubscribers += 1;
    listeners.add(setState);
    setState(cache);

    void fetchUnreadCount();
    if (uid) ensureRealtimeSubscription(uid);

    return () => {
      listeners.delete(setState);
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      cleanupRealtimeSubscription();
    };
  }, [uid]);

  return {
    unreadCount: state.unreadCount,
    urgentUnreadCount: state.urgentUnreadCount,
    lastUrgentAt: state.lastUrgentAt,
    refetch: fetchUnreadCount,
  };
};
