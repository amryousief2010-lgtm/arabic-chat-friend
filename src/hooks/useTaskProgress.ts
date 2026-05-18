import { useCallback, useEffect, useState } from "react";

/** Local YYYY-MM-DD (user's timezone) so a "day" matches their workday. */
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** ISO week key like 2026-W20 — used for weekly reminders. */
export const weekKey = () => {
  const d = new Date();
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
};

const storageKey = (userId: string) => `task-progress:${userId}:${todayKey()}`;

/** Per-user, per-day completion map for QuickGuide links keyed by path. */
export function useTaskProgress(userId: string | undefined) {
  const [completed, setCompleted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!userId) return;
    try {
      const raw = localStorage.getItem(storageKey(userId));
      setCompleted(raw ? JSON.parse(raw) : {});
    } catch {
      setCompleted({});
    }
  }, [userId]);

  const persist = useCallback(
    (next: Record<string, boolean>) => {
      if (!userId) return;
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(next));
      } catch {
        /* ignore quota */
      }
    },
    [userId],
  );

  const toggle = useCallback(
    (path: string) => {
      setCompleted((prev) => {
        const next = { ...prev, [path]: !prev[path] };
        if (!next[path]) delete next[path];
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setMany = useCallback(
    (paths: string[], value: boolean) => {
      setCompleted((prev) => {
        const next = { ...prev };
        for (const p of paths) {
          if (value) next[p] = true;
          else delete next[p];
        }
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { completed, toggle, setMany };
}
