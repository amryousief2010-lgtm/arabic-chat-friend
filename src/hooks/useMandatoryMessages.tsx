import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Shared counter for mandatory (requires_reply) messages that the current user
 * has not replied to yet. Kept in a module-level cache so the sidebar badge,
 * the internal-messages tab and the dedicated page stay in sync via Realtime.
 */
let cache = 0;
let channel: ReturnType<typeof supabase.channel> | null = null;
let subs = 0;
const listeners = new Set<(n: number) => void>();
const notify = (n: number) => {
  cache = n;
  listeners.forEach((l) => l(n));
};

export const fetchMandatoryPendingCount = async (uid: string) => {
  const { data: recs } = await (supabase as any)
    .from("internal_message_recipients")
    .select("message_id")
    .eq("recipient_id", uid)
    .is("replied_at", null);
  const ids = (recs || []).map((r: any) => r.message_id as string);
  if (ids.length === 0) {
    notify(0);
    return 0;
  }
  const { count } = await (supabase as any)
    .from("internal_messages")
    .select("id", { count: "exact", head: true })
    .in("id", ids)
    .eq("requires_reply", true)
    .eq("is_deleted", false);
  const n = Number(count || 0);
  notify(n);
  return n;
};

const ensureChannel = (uid: string) => {
  if (channel) return;
  channel = supabase
    .channel(`mandatory-messages-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "internal_message_recipients", filter: `recipient_id=eq.${uid}` },
      () => void fetchMandatoryPendingCount(uid),
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "internal_messages" },
      () => void fetchMandatoryPendingCount(uid),
    )
    .subscribe();
};

const cleanup = () => {
  if (!channel || subs > 0) return;
  void supabase.removeChannel(channel);
  channel = null;
};

export const useMandatoryMessages = () => {
  const { user } = useAuth();
  const [n, setN] = useState(cache);

  useEffect(() => {
    if (!user) return;
    subs += 1;
    listeners.add(setN);
    setN(cache);
    void fetchMandatoryPendingCount(user.id);
    ensureChannel(user.id);
    return () => {
      listeners.delete(setN);
      subs = Math.max(0, subs - 1);
      cleanup();
    };
  }, [user?.id]);

  return { pendingCount: n, refetch: () => user && fetchMandatoryPendingCount(user.id) };
};
