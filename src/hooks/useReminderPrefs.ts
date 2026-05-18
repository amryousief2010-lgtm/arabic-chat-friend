import { useCallback, useEffect, useState } from "react";

export type ReminderPrefs = {
  daily: boolean;
  weekly: boolean;
  /** HH:MM 24h, local time. Reminder fires at/after this time once per day. */
  dailyTime: string;
  /** HH:MM 24h, local time. Reminder fires at/after this on weeklyDay. */
  weeklyTime: string;
  /** 0=Sunday … 6=Saturday */
  weeklyDay: number;
  /** Toast on every task completion toggle */
  toastOnToggle: boolean;
};

const KEY = (userId: string) => `reminder-prefs:${userId}`;
const DEFAULTS: ReminderPrefs = {
  daily: true,
  weekly: true,
  dailyTime: "08:00",
  weeklyTime: "09:00",
  weeklyDay: 0, // Sunday — start of Egyptian work week
  toastOnToggle: true,
};

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
