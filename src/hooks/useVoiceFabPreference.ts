import { useCallback, useEffect, useState } from "react";

/** إخفاء الزر العائم للمساعد الصوتي، لكل مستخدم في localStorage. */
export const voiceFabHiddenKey = (userId: string) => `voice-assistant-fab-hidden:${userId}`;
export const VOICE_FAB_PREF_EVENT = "voice-fab-pref";

export function readVoiceFabHidden(userId: string | undefined | null): boolean {
  if (!userId || typeof localStorage === "undefined") return false;
  return localStorage.getItem(voiceFabHiddenKey(userId)) === "1";
}

export function writeVoiceFabHidden(userId: string, hidden: boolean) {
  localStorage.setItem(voiceFabHiddenKey(userId), hidden ? "1" : "0");
  window.dispatchEvent(new CustomEvent(VOICE_FAB_PREF_EVENT, { detail: { userId, hidden } }));
}

export function useVoiceFabPreference(userId: string | undefined) {
  const [hidden, setHiddenState] = useState(() => readVoiceFabHidden(userId));

  useEffect(() => {
    setHiddenState(readVoiceFabHidden(userId));
    const onPref = (e: Event) => {
      const d = (e as CustomEvent<{ userId: string; hidden: boolean }>).detail;
      if (d?.userId === userId) setHiddenState(!!d.hidden);
    };
    const onStorage = (e: StorageEvent) => {
      if (!userId || e.key !== voiceFabHiddenKey(userId)) return;
      setHiddenState(e.newValue === "1");
    };
    window.addEventListener(VOICE_FAB_PREF_EVENT, onPref);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(VOICE_FAB_PREF_EVENT, onPref);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId]);

  const setHidden = useCallback((next: boolean) => {
    if (!userId) return;
    writeVoiceFabHidden(userId, next);
    setHiddenState(next);
  }, [userId]);

  return { hidden, setHidden };
}
