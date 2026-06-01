import { useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getGuideForRole } from "@/data/roleGuides";
import { todayKey, weekKey } from "@/hooks/useTaskProgress";
import { getReminderPrefs } from "@/hooks/useReminderPrefs";

/** HH:MM string → minutes since midnight. */
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Time-aware in-app reminders.
 * Checks every 60s and fires daily/weekly toasts when the configured time has passed,
 * once per day / per ISO week, respecting enable toggles in reminder prefs.
 */
const SUPPRESSED_ROLES = new Set(["sales_moderator", "marketing_sales_manager"]);

export function useDailyReminders() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (!user || !role) return;
    if (SUPPRESSED_ROLES.has(role)) return;
    const guide = getGuideForRole(role);
    if (!guide) return;

    const check = () => {
      try {
        const prefs = getReminderPrefs(user.id);
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const dailyFlag = `reminder-daily:${user.id}:${todayKey()}`;
        const weeklyFlag = `reminder-weekly:${user.id}:${weekKey()}`;

        if (prefs.daily && nowMin >= toMin(prefs.dailyTime) && !localStorage.getItem(dailyFlag)) {
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

        if (
          prefs.weekly &&
          now.getDay() === (prefs.weeklyDay ?? 0) &&
          nowMin >= toMin(prefs.weeklyTime) &&
          !localStorage.getItem(weeklyFlag)
        ) {
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
    };

    const initial = setTimeout(check, 1500);
    const id = setInterval(check, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [user, role]);
}
