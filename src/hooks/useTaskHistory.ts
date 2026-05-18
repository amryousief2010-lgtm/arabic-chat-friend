import { useEffect, useMemo } from "react";
import { todayKey, weekKey } from "@/hooks/useTaskProgress";

export type HistoryEntry = {
  date: string; // YYYY-MM-DD
  week: string; // YYYY-Www
  dailyDone: number;
  dailyTotal: number;
  weeklyDone: number;
  weeklyTotal: number;
};

type Snapshot = Omit<HistoryEntry, "date" | "week">;

const KEY = (userId: string) => `task-history:${userId}`;

function readAll(userId: string): Record<string, HistoryEntry> {
  try {
    const raw = localStorage.getItem(KEY(userId));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Upsert today's snapshot. Call whenever today's progress changes. */
export function writeTodaySnapshot(userId: string, snap: Snapshot) {
  try {
    const all = readAll(userId);
    const date = todayKey();
    all[date] = { date, week: weekKey(), ...snap };
    localStorage.setItem(KEY(userId), JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

export function useTaskHistory(userId: string | undefined, refreshToken: unknown) {
  const entries = useMemo<HistoryEntry[]>(() => {
    if (!userId) return [];
    const all = readAll(userId);
    return Object.values(all).sort((a, b) => (a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, refreshToken]);

  // No-op effect kept for symmetry / future server sync
  useEffect(() => {}, [userId]);

  const weekly = useMemo(() => {
    const buckets = new Map<string, { week: string; dailyDone: number; dailyTotal: number; weeklyDone: number; weeklyTotal: number; days: number }>();
    for (const e of entries) {
      const b = buckets.get(e.week) ?? { week: e.week, dailyDone: 0, dailyTotal: 0, weeklyDone: 0, weeklyTotal: 0, days: 0 };
      b.dailyDone += e.dailyDone;
      b.dailyTotal += e.dailyTotal;
      // For weekly tasks take the max snapshot of the week (cumulative within week)
      b.weeklyDone = Math.max(b.weeklyDone, e.weeklyDone);
      b.weeklyTotal = Math.max(b.weeklyTotal, e.weeklyTotal);
      b.days += 1;
      buckets.set(e.week, b);
    }
    return Array.from(buckets.values()).sort((a, b) => (a.week < b.week ? 1 : -1));
  }, [entries]);

  return { entries, weekly };
}
