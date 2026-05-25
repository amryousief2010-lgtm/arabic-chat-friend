import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Clock } from "lucide-react";

/**
 * Floating Clock + Calendar widget — visible to all users on every page.
 * Modern analog clock face + digital time + Gregorian & Hijri dates + mini calendar.
 */
const ClockCalendarWidget = () => {
  const [now, setNow] = useState(new Date());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours();

  const secDeg = seconds * 6;
  const minDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = (hours % 12) * 30 + minutes * 0.5;

  const gregorian = new Intl.DateTimeFormat("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(now);

  const digital = new Intl.DateTimeFormat("ar-EG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label="الساعة والتاريخ"
          className="fixed z-40 left-4 bottom-24 md:bottom-6 group"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-primary to-accent shadow-xl ring-2 ring-background flex items-center justify-center transition-transform group-hover:scale-110">
            {/* Mini analog face */}
            <div className="absolute inset-1.5 rounded-full bg-background/95 backdrop-blur-sm flex items-center justify-center overflow-hidden">
              <div
                className="absolute w-[2px] h-3 bg-foreground rounded origin-bottom"
                style={{
                  bottom: "50%",
                  transform: `translateY(0) rotate(${hourDeg}deg)`,
                  transformOrigin: "50% 100%",
                }}
              />
              <div
                className="absolute w-[1.5px] h-4 bg-foreground rounded origin-bottom"
                style={{
                  bottom: "50%",
                  transform: `rotate(${minDeg}deg)`,
                  transformOrigin: "50% 100%",
                }}
              />
              <div
                className="absolute w-[1px] h-4 bg-destructive rounded origin-bottom"
                style={{
                  bottom: "50%",
                  transform: `rotate(${secDeg}deg)`,
                  transformOrigin: "50% 100%",
                }}
              />
              <div className="w-1 h-1 rounded-full bg-primary z-10" />
            </div>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-0 overflow-hidden">
        {/* Header with large analog clock */}
        <div className="bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground">
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 rounded-full bg-background/95 ring-4 ring-background/30 shadow-inner">
              {/* Hour marks */}
              {[...Array(12)].map((_, i) => (
                <div
                  key={i}
                  className="absolute left-1/2 top-1 w-[2px] h-2 bg-foreground/60 origin-bottom"
                  style={{
                    transform: `translateX(-50%) rotate(${i * 30}deg)`,
                    transformOrigin: "50% 46px",
                  }}
                />
              ))}
              {/* Hands */}
              <div
                className="absolute left-1/2 top-1/2 w-[3px] h-6 bg-foreground rounded -translate-x-1/2"
                style={{
                  transform: `translate(-50%, -100%) rotate(${hourDeg}deg)`,
                  transformOrigin: "50% 100%",
                }}
              />
              <div
                className="absolute left-1/2 top-1/2 w-[2px] h-9 bg-foreground rounded -translate-x-1/2"
                style={{
                  transform: `translate(-50%, -100%) rotate(${minDeg}deg)`,
                  transformOrigin: "50% 100%",
                }}
              />
              <div
                className="absolute left-1/2 top-1/2 w-[1px] h-10 bg-destructive rounded -translate-x-1/2"
                style={{
                  transform: `translate(-50%, -100%) rotate(${secDeg}deg)`,
                  transformOrigin: "50% 100%",
                }}
              />
              <div className="absolute left-1/2 top-1/2 w-2 h-2 rounded-full bg-primary -translate-x-1/2 -translate-y-1/2" />
            </div>
            <div className="flex-1">
              <div className="text-2xl font-bold tabular-nums" dir="ltr">
                {digital}
              </div>
              <div className="text-xs opacity-90 mt-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                توقيت القاهرة
              </div>
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="p-3 space-y-1.5 border-b">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">ميلادي:</span>
            <span className="font-semibold">{gregorian}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">هجري:</span>
            <span className="font-semibold">{hijri}</span>
          </div>
        </div>

        {/* Mini calendar */}
        <Calendar
          mode="single"
          selected={now}
          onSelect={() => {}}
          className="rounded-none"
        />
      </PopoverContent>
    </Popover>
  );
};

export default ClockCalendarWidget;
