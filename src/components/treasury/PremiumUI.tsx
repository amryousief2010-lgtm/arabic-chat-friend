import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "primary" | "success" | "warning" | "danger" | "info" | "neutral" | "accent";

const TONE_STYLES: Record<Tone, { ring: string; iconBg: string; iconFg: string; valueFg: string; cardBg: string; border: string }> = {
  primary: {
    ring: "ring-1 ring-primary/20",
    iconBg: "bg-primary/10",
    iconFg: "text-primary",
    valueFg: "text-foreground",
    cardBg: "bg-gradient-to-br from-primary/10 via-card to-card",
    border: "border-primary/30",
  },
  success: {
    ring: "ring-1 ring-[hsl(var(--success))]/20",
    iconBg: "bg-[hsl(var(--success))]/10",
    iconFg: "text-[hsl(var(--success))]",
    valueFg: "text-foreground",
    cardBg: "bg-gradient-to-br from-[hsl(var(--success))]/10 via-card to-card",
    border: "border-[hsl(var(--success))]/30",
  },
  warning: {
    ring: "ring-1 ring-[hsl(var(--warning))]/30",
    iconBg: "bg-[hsl(var(--warning))]/15",
    iconFg: "text-[hsl(var(--warning))]",
    valueFg: "text-foreground",
    cardBg: "bg-gradient-to-br from-[hsl(var(--warning))]/10 via-card to-card",
    border: "border-[hsl(var(--warning))]/30",
  },
  danger: {
    ring: "ring-1 ring-destructive/20",
    iconBg: "bg-destructive/10",
    iconFg: "text-destructive",
    valueFg: "text-foreground",
    cardBg: "bg-gradient-to-br from-destructive/10 via-card to-card",
    border: "border-destructive/30",
  },
  info: {
    ring: "ring-1 ring-[hsl(var(--chart-4))]/20",
    iconBg: "bg-[hsl(var(--chart-4))]/10",
    iconFg: "text-[hsl(var(--chart-4))]",
    valueFg: "text-foreground",
    cardBg: "bg-gradient-to-br from-[hsl(var(--chart-4))]/10 via-card to-card",
    border: "border-[hsl(var(--chart-4))]/30",
  },
  accent: {
    ring: "ring-1 ring-accent/20",
    iconBg: "bg-accent/10",
    iconFg: "text-accent",
    valueFg: "text-foreground",
    cardBg: "bg-gradient-to-br from-accent/10 via-card to-card",
    border: "border-accent/30",
  },
  neutral: {
    ring: "",
    iconBg: "bg-muted",
    iconFg: "text-muted-foreground",
    valueFg: "text-foreground",
    cardBg: "bg-card",
    border: "border-border",
  },
};

export interface PremiumStatProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  tone?: Tone;
  hint?: string;
  trend?: { value: string; positive?: boolean };
  highlight?: boolean;
  currency?: string;
  onClick?: () => void;
}

export function PremiumStat({ title, value, icon, tone = "neutral", hint, trend, highlight, currency = "ج.م", onClick }: PremiumStatProps) {
  const s = TONE_STYLES[tone];
  return (
    <Card
      onClick={onClick}
      className={cn(
        "relative overflow-hidden border transition-all duration-300",
        s.cardBg,
        s.border,
        highlight && "shadow-lg shadow-primary/10 ring-2 ring-primary/30",
        onClick && "cursor-pointer hover:shadow-md hover:-translate-y-0.5",
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-muted-foreground tracking-wide uppercase truncate">{title}</div>
            <div className="mt-2 flex items-baseline gap-1.5 flex-wrap">
              <span className={cn("text-2xl md:text-3xl font-extrabold font-mono tracking-tight tabular-nums", s.valueFg)}>
                {value}
              </span>
              {currency && <span className="text-xs text-muted-foreground font-medium">{currency}</span>}
            </div>
            {hint && <div className="mt-1.5 text-[11px] text-muted-foreground">{hint}</div>}
            {trend && (
              <div className={cn("mt-2 text-xs font-semibold", trend.positive ? "text-[hsl(var(--success))]" : "text-destructive")}>
                {trend.positive ? "▲" : "▼"} {trend.value}
              </div>
            )}
          </div>
          {icon && (
            <div className={cn("shrink-0 w-11 h-11 rounded-xl flex items-center justify-center", s.iconBg, s.iconFg)}>
              <div className="[&>svg]:w-5 [&>svg]:h-5">{icon}</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function HeroSummary({
  title,
  subtitle,
  badge,
  primaryValue,
  primaryLabel,
  pills,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  primaryValue: string;
  primaryLabel: string;
  pills?: { label: string; value: string; tone?: Tone }[];
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-card">
      <div className="absolute inset-y-0 end-0 w-1/3 bg-gradient-to-l from-accent/10 to-transparent pointer-events-none" />
      <CardContent className="p-6 relative">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            {icon && <div className="w-12 h-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-md shadow-primary/30 [&>svg]:w-6 [&>svg]:h-6">{icon}</div>}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl md:text-2xl font-bold">{title}</h2>
                {badge}
              </div>
              {subtitle && <p className="text-xs text-muted-foreground mt-1 max-w-xl">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 items-center">
          <div className="rounded-2xl bg-card/80 backdrop-blur border px-6 py-4 shadow-sm">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{primaryLabel}</div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl md:text-5xl font-extrabold font-mono text-primary tabular-nums">{primaryValue}</span>
              <span className="text-sm text-muted-foreground font-medium">ج.م</span>
            </div>
          </div>
          {pills && pills.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {pills.map((p, i) => {
                const tone = TONE_STYLES[p.tone || "neutral"];
                return (
                  <div key={i} className={cn("rounded-xl border px-3 py-2 bg-card/70 backdrop-blur-sm", tone.border)}>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{p.label}</div>
                    <div className={cn("mt-0.5 text-base font-bold font-mono tabular-nums truncate", tone.iconFg)}>{p.value}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SectionTitle({ icon, title, action }: { icon?: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mt-2 mb-1">
      <div className="flex items-center gap-2">
        {icon && <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center [&>svg]:w-4 [&>svg]:h-4">{icon}</div>}
        <h3 className="text-base font-bold">{title}</h3>
      </div>
      {action}
    </div>
  );
}

export function StatusPill({
  tone,
  children,
  icon,
}: {
  tone: "success" | "warning" | "danger" | "info" | "neutral";
  children: ReactNode;
  icon?: ReactNode;
}) {
  const styles: Record<string, string> = {
    success: "bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] border-[hsl(var(--success))]/30",
    warning: "bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/30",
    danger: "bg-destructive/15 text-destructive border-destructive/30",
    info: "bg-[hsl(var(--chart-4))]/15 text-[hsl(var(--chart-4))] border-[hsl(var(--chart-4))]/30",
    neutral: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap", styles[tone])}>
      {icon}
      {children}
    </span>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-32 rounded-xl bg-muted/60" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-muted/60" />)}
      </div>
      <div className="h-48 rounded-xl bg-muted/60" />
    </div>
  );
}

export function EmptyState({ icon, title, description }: { icon?: ReactNode; title: string; description?: string }) {
  return (
    <div className="text-center py-10 px-4">
      {icon && <div className="mx-auto w-14 h-14 rounded-2xl bg-muted text-muted-foreground flex items-center justify-center mb-3 [&>svg]:w-7 [&>svg]:h-7">{icon}</div>}
      <div className="font-semibold text-sm">{title}</div>
      {description && <div className="text-xs text-muted-foreground mt-1">{description}</div>}
    </div>
  );
}

export function ActivityTimeline({
  items,
}: {
  items: { id: string; title: string; subtitle?: string; amount?: string; date: string; tone?: "success" | "warning" | "danger" | "info" | "neutral"; icon?: ReactNode }[];
}) {
  if (!items.length) return <EmptyState title="لا توجد حركات" description="آخر الحركات ستظهر هنا فور تسجيلها" />;
  return (
    <ol className="relative space-y-3 ps-5 before:absolute before:top-2 before:bottom-2 before:start-2 before:w-px before:bg-border">
      {items.map((it) => {
        const dot = {
          success: "bg-[hsl(var(--success))]",
          warning: "bg-[hsl(var(--warning))]",
          danger: "bg-destructive",
          info: "bg-[hsl(var(--chart-4))]",
          neutral: "bg-muted-foreground",
        }[it.tone || "neutral"];
        return (
          <li key={it.id} className="relative">
            <span className={cn("absolute -start-[14px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-background", dot)} />
            <div className="flex items-start justify-between gap-3 rounded-lg border bg-card/50 px-3 py-2 hover:bg-card transition-colors">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{it.title}</div>
                {it.subtitle && <div className="text-[11px] text-muted-foreground truncate">{it.subtitle}</div>}
                <div className="text-[10px] text-muted-foreground mt-0.5">{it.date}</div>
              </div>
              {it.amount && <div className="font-mono font-bold tabular-nums text-sm shrink-0">{it.amount}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressRing({ percent, size = 96, label, sublabel, tone }: { percent: number; size?: number; label: string; sublabel?: string; tone?: "success" | "warning" | "danger" }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percent));
  const offset = c - (pct / 100) * c;
  const color = tone === "danger" ? "hsl(var(--destructive))" : tone === "warning" ? "hsl(var(--warning))" : "hsl(var(--success))";
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} className="-rotate-90 shrink-0">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-700"
        />
      </svg>
      <div>
        <div className="text-3xl font-extrabold font-mono tabular-nums">{pct.toFixed(0)}%</div>
        <div className="text-sm font-semibold">{label}</div>
        {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
      </div>
    </div>
  );
}

export function getCairoNow() {
  return new Date().toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
}
