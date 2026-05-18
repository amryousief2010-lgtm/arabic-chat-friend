import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getGuideForRole } from "@/data/roleGuides";
import { todayKey, weekKey } from "@/hooks/useTaskProgress";
import { getReminderPrefs } from "@/hooks/useReminderPrefs";

/**
 * In-app reminders for each user's role-specific tasks.
 * - Daily: one toast per day on first authenticated mount.
 * - Weekly: one toast per ISO week, mentioning weekly-cadence tasks.
 * Tracked in localStorage per-user to avoid spamming on every navigation.
 */
export function useDailyReminders() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (!user || !role) return;
    const guide = getGuideForRole(role);
    if (!guide) return;

    const dailyFlag = `reminder-daily:${user.id}:${todayKey()}`;
    const weeklyFlag = `reminder-weekly:${user.id}:${weekKey()}`;

    // Defer so it doesn't fight initial render
    const t = setTimeout(() => {
      const prefs = getReminderPrefs(user.id);
      try {
        if (prefs.daily && !localStorage.getItem(dailyFlag)) {
          const dailyTasks = guide.links.filter((l) => (l.cadence ?? "daily") === "daily");
          if (dailyTasks.length) {
            toast(`تذكير يومي — ${guide.title}`, {
              description: `لديك ${dailyTasks.length} مهام يومية. افتح دليلك السريع لبدء اليوم.`,
              duration: 7000,
              action: { label: "دليلي", onClick: () => (window.location.href = "/quick-guide") },
            });
          }
          localStorage.setItem(dailyFlag, "1");
        }


        if (prefs.weekly && !localStorage.getItem(weeklyFlag)) {
          const weeklyTasks = guide.links.filter((l) => l.cadence === "weekly");
          if (weeklyTasks.length) {
            toast(`تذكير أسبوعي — ${guide.title}`, {
              description: `راجع هذا الأسبوع: ${weeklyTasks.map((t) => t.label).join("، ")}.`,
              duration: 9000,
              action: { label: "افتح", onClick: () => (window.location.href = "/quick-guide") },
            });
          }
          localStorage.setItem(weeklyFlag, "1");
        }
      } catch {
        /* ignore */
      }
    }, 1500);

    return () => clearTimeout(t);
  }, [user, role]);
}
