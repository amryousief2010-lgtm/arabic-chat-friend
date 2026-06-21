import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Tracks the current user's presence in `public.user_presence`.
 * - Upserts row on mount (status=online, session_started_at=now)
 * - Refreshes last_seen_at every 60s
 * - Updates current_page on route change
 * - Marks offline on signOut (handled in useAuth) and on tab close
 *
 * Does NOT record content the user types — only connection metadata.
 */
export function useUserPresence() {
  const { user, role, profile } = useAuth();
  const location = useLocation();
  const sessionStartRef = useRef<string>(new Date().toISOString());
  const lastActivityRef = useRef<number>(Date.now());

  // Track local user activity for status calculation
  useEffect(() => {
    const bump = () => { lastActivityRef.current = Date.now(); };
    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, bump));
  }, []);

  // Heartbeat + route-change update
  useEffect(() => {
    if (!user) return;

    const computeStatus = (): "online" | "away" => {
      const idleMs = Date.now() - lastActivityRef.current;
      return idleMs > 5 * 60 * 1000 ? "away" : "online";
    };

    const upsert = async (overrides: Record<string, unknown> = {}) => {
      try {
        await supabase.from("user_presence").upsert(
          {
            user_id: user.id,
            user_name: profile?.full_name || user.email || null,
            role: role || null,
            status: computeStatus(),
            last_seen_at: new Date().toISOString(),
            current_page: location.pathname,
            user_agent: navigator.userAgent.slice(0, 200),
            session_started_at: sessionStartRef.current,
            updated_at: new Date().toISOString(),
            ...overrides,
          },
          { onConflict: "user_id" }
        );
      } catch {
        // ignore presence errors silently
      }
    };

    // Immediate ping on mount/route change
    upsert();

    const interval = setInterval(() => upsert(), 60 * 1000);

    // Mark offline on tab close
    const onUnload = () => {
      try {
        const url = `https://ssznmzijopyxkwpctcxw.supabase.co/rest/v1/user_presence?user_id=eq.${user.id}`;
        // Best-effort fire-and-forget; ignored if blocked
        navigator.sendBeacon?.(url);
      } catch {}
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [user, role, profile?.full_name, location.pathname]);
}
