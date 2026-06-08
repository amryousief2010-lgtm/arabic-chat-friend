import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

let cache = 0;
let channel: ReturnType<typeof supabase.channel> | null = null;
let subs = 0;
const listeners = new Set<(n: number) => void>();
const notify = (n: number) => {
  cache = n;
  listeners.forEach((l) => l(n));
};

const fetchCount = async (uid: string) => {
  const { count } = await (supabase as any)
    .from("internal_message_recipients")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", uid)
    .is("read_at", null)
    .is("archived_at", null);
  notify(Number(count || 0));
};

const ensureChannel = (uid: string) => {
  if (channel) return;
  channel = supabase
    .channel(`unread-internal-messages-${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "internal_message_recipients", filter: `recipient_id=eq.${uid}` },
      () => void fetchCount(uid),
    )
    .subscribe();
};

const cleanup = () => {
  if (!channel || subs > 0) return;
  void supabase.removeChannel(channel);
  channel = null;
};

export const useUnreadInternalMessages = () => {
  const { user } = useAuth();
  const [n, setN] = useState(cache);

  useEffect(() => {
    if (!user) return;
    subs += 1;
    listeners.add(setN);
    setN(cache);
    void fetchCount(user.id);
    ensureChannel(user.id);
    return () => {
      listeners.delete(setN);
      subs = Math.max(0, subs - 1);
      cleanup();
    };
  }, [user?.id]);

  return { unreadCount: n, refetch: () => user && fetchCount(user.id) };
};
