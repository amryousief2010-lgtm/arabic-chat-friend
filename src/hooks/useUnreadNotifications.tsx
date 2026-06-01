import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Keep in sync with src/pages/Notifications.tsx requiresImmediateReply().
const INFORMATIONAL_TYPES = new Set(['low_stock', 'production_needed']);
const ALWAYS_URGENT_TYPES = new Set(['farm_shipment', 'farm_shipment_receipt']);
const ALWAYS_URGENT_LIST = Array.from(ALWAYS_URGENT_TYPES);
const EXCLUDED_ORDER_URGENT_TYPES = Array.from(new Set([...INFORMATIONAL_TYPES, ...ALWAYS_URGENT_TYPES]));

const toPostgrestInList = (values: string[]) => `(${values.map((value) => JSON.stringify(value)).join(',')})`;

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
    const unreadBase = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);

    const [totalRes, alwaysUrgentRes, orderUrgentTypedRes, orderUrgentNullTypeRes] = await Promise.all([
      unreadBase,
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false)
        .in('type', ALWAYS_URGENT_LIST),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false)
        .not('order_id', 'is', null)
        .not('type', 'is', null)
        .filter('type', 'not.in', toPostgrestInList(EXCLUDED_ORDER_URGENT_TYPES)),
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('is_read', false)
        .not('order_id', 'is', null)
        .is('type', null),
    ]);

    const hasError = totalRes.error || alwaysUrgentRes.error || orderUrgentTypedRes.error || orderUrgentNullTypeRes.error;

    if (!hasError) {
      const urgent =
        Number(alwaysUrgentRes.count || 0) +
        Number(orderUrgentTypedRes.count || 0) +
        Number(orderUrgentNullTypeRes.count || 0);

      notifyListeners({
        unreadCount: Number(totalRes.count || 0),
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

const ensureRealtimeSubscription = () => {
  if (realtimeChannel) return;

  realtimeChannel = supabase
    .channel('unread-notifications')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      (payload) => {
        const row = payload.new as { is_read?: boolean; type?: string; order_id?: string | null };
        if (!row.is_read && isUrgent(row)) {
          cache = { ...cache, lastUrgentAt: Date.now() };
          notifyListeners(cache);
          playUrgentSound();
        }
        void fetchUnreadCount();
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'notifications' },
      () => { void fetchUnreadCount(); }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'notifications' },
      () => { void fetchUnreadCount(); }
    )
    .subscribe();
};

const cleanupRealtimeSubscription = () => {
  if (!realtimeChannel || activeSubscribers > 0) return;
  void supabase.removeChannel(realtimeChannel);
  realtimeChannel = null;
};

export const useUnreadNotifications = () => {
  const [state, setState] = useState<UnreadState>(cache);

  useEffect(() => {
    activeSubscribers += 1;
    listeners.add(setState);
    setState(cache);

    void fetchUnreadCount();
    ensureRealtimeSubscription();

    return () => {
      listeners.delete(setState);
      activeSubscribers = Math.max(0, activeSubscribers - 1);
      cleanupRealtimeSubscription();
    };
  }, []);

  return {
    unreadCount: state.unreadCount,
    urgentUnreadCount: state.urgentUnreadCount,
    lastUrgentAt: state.lastUrgentAt,
    refetch: fetchUnreadCount,
  };
};
