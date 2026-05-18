import { useCallback, useEffect, useState } from "react";

export type ReminderPrefs = {
  daily: boolean;
  weekly: boolean;
};

const KEY = (userId: string) => `reminder-prefs:${userId}`;
const DEFAULTS: ReminderPrefs = { daily: true, weekly: true };

export function getReminderPrefs(userId: string): ReminderPrefs {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function useReminderPrefs(userId: string | undefined) {
  const [prefs, setPrefs] = useState<ReminderPrefs>(DEFAULTS);

  useEffect(() => {
    if (!userId) return;
    setPrefs(getReminderPrefs(userId));
  }, [userId]);

  const update = useCallback(
    (patch: Partial<ReminderPrefs>) => {
      if (!userId) return;
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        try {
          localStorage.setItem(KEY(userId), JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [userId],
  );

  return { prefs, update };
}
