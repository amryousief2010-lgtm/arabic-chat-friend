import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowLeft } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getGuideForRole } from "@/data/roleGuides";
import { todayKey, useTaskProgress } from "@/hooks/useTaskProgress";

/**
 * "Start of Day" modal — appears once per day on first authenticated render.
 * Shows the user's role-specific daily tasks with quick check-off + deep links.
 */
const StartOfDayDialog = () => {
  const { user, role, profile } = useAuth();
  const guide = getGuideForRole(role);
  const { completed, toggle } = useTaskProgress(user?.id);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || !guide) return;
    const flag = `start-of-day:${user.id}:${todayKey()}`;
    try {
      if (!localStorage.getItem(flag)) {
        const t = setTimeout(() => setOpen(true), 800);
        return () => clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, [user, guide]);

  const handleClose = (next: boolean) => {
    setOpen(next);
    if (!next && user) {
      try {
        localStorage.setItem(`start-of-day:${user.id}:${todayKey()}`, "1");
      } catch {
        /* ignore */
      }
    }
  };

  if (!guide) return null;
  const dailyLinks = guide.links.filter((l) => (l.cadence ?? "daily") === "daily");
  const doneCount = dailyLinks.filter((l) => completed[l.path]).length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            مهام بداية اليوم
          </DialogTitle>
          <DialogDescription>
            مرحبًا {profile?.full_name || profile?.email || ""} — دورك: <b>{guide.title}</b>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">قائمة اليوم</span>
          <Badge variant="secondary">
            {doneCount} / {dailyLinks.length} مكتملة
          </Badge>
        </div>

        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {dailyLinks.map((l) => {
            const isDone = !!completed[l.path];
            return (
              <div
                key={l.path}
                className={`flex items-center justify-between gap-3 rounded-lg border p-3 transition ${
                  isDone ? "bg-muted/40" : "bg-card"
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <Checkbox checked={isDone} onCheckedChange={() => toggle(l.path)} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : ""}`}>
                      {l.label}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{l.desc}</div>
                  </div>
                </div>
                <Link to={l.path} onClick={() => handleClose(false)}>
                  <Button variant="ghost" size="sm" className="gap-1">
                    افتح <ArrowLeft className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            );
          })}
          {dailyLinks.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-6">لا توجد مهام يومية محددة لدورك.</div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Link to="/quick-guide" onClick={() => handleClose(false)} className="w-full sm:w-auto">
            <Button variant="outline" className="w-full">دليلي السريع</Button>
          </Link>
          <Button onClick={() => handleClose(false)} className="w-full sm:w-auto">ابدأ اليوم</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StartOfDayDialog;
