import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Wheat, Plus, Settings as SettingsIcon, AlertTriangle, VolumeX, RefreshCw, Sliders } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/hooks/useAuth";

const todayCairo = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  return format(d, "yyyy-MM-dd");
};

const fmt = (n: number) => (n ?? 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });

export default function MotherFarmFeedInventory() {
  const qc = useQueryClient();
  const { isGeneralManager, isExecutiveManager, isWarehouseSupervisor } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || isWarehouseSupervisor;

  const { data: settings } = useQuery({
    queryKey: ["mff_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mother_farm_feed_settings" as any).select("*").maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: balance, refetch: refetchBalance } = useQuery({
    queryKey: ["mff_balance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_mother_farm_feed_balance" as any).select("*").maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: movements = [], refetch: refetchMoves } = useQuery({
    queryKey: ["mff_movements"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mother_farm_feed_movements" as any)
        .select("*").order("movement_date", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  // Auto-apply daily consumption when page opens
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    appliedRef.current = true;
    (async () => {
      const { data, error } = await supabase.rpc("apply_mother_farm_daily_consumption" as any);
      if (!error && data && Array.isArray(data) && data[0]?.days_added > 0) {
        toast.success(`تم خصم استهلاك ${data[0].days_added} يوم تلقائيًا (${fmt(Number(data[0].total_deducted_kg))} كجم)`);
        refetchBalance(); refetchMoves();
      }
    })();
  }, [refetchBalance, refetchMoves]);

  const dailyKg = settings ? Number(settings.current_bird_count) * Number(settings.daily_consumption_per_bird_kg) : 118;
  const bagWeight = Number(settings?.bag_weight_kg || 40);
  const threshold = Number(settings?.low_stock_threshold_kg || 600);
  const balanceKg = Number(balance?.balance_kg || 0);
  const bagsApprox = balanceKg > 0 ? balanceKg / bagWeight : 0;
  const daysCover = dailyKg > 0 ? balanceKg / dailyKg : 0;

  const status: "safe" | "low" | "danger" =
    balanceKg <= 0 ? "danger" : balanceKg < threshold ? "low" : "safe";

  // Sound alert (once per page open) when below threshold
  const beepedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    if (beepedRef.current || muted) return;
    if (balance == null || settings == null) return;
    if (status === "safe") return;
    beepedRef.current = true;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playBeep = (freq: number, start: number, dur = 0.18) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.value = 0.18;
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };
      playBeep(880, 0); playBeep(660, 0.22); playBeep(880, 0.44);
    } catch {}
  }, [balance, settings, status, muted]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Location header */}
      <Card className="p-4 bg-gradient-to-br from-purple-50 to-orange-50 border-purple-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="font-bold flex items-center gap-2"><Wheat className="w-5 h-5 text-orange-600" />مخزون علف مزرعة الأمهات</h3>
            <p className="text-xs text-muted-foreground mt-1">📍 {settings?.location_text || "—"}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={async () => {
              const { data, error } = await supabase.rpc("apply_mother_farm_daily_consumption" as any);
              if (error) return toast.error(error.message);
              toast.success(`تم: ${data?.[0]?.days_added || 0} يوم (${fmt(Number(data?.[0]?.total_deducted_kg || 0))} كجم)`);
              refetchBalance(); refetchMoves();
            }}><RefreshCw className="w-4 h-4 ml-1" />تشغيل الخصم اليومي</Button>
            {canManage && <SettingsDialog settings={settings} onSaved={() => { qc.invalidateQueries({ queryKey: ["mff_settings"] }); refetchBalance(); refetchMoves(); }} />}
          </div>
        </div>
      </Card>

      {/* Low-stock alert */}
      {status !== "safe" && (
        <Card className={`p-4 border-2 ${status === "danger" ? "border-red-500 bg-red-50" : "border-amber-500 bg-amber-50"}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-6 h-6" />
              <div>
                <p className="font-bold">
                  {status === "danger"
                    ? "خطر: رصيد علف الأمهات صفر أو سالب!"
                    : `تحذير: رصيد علف الأمهات أقل من الحد الآمن ${fmt(threshold)} كجم`}
                </p>
                <p className="text-xs">الرصيد الحالي: {fmt(balanceKg)} كجم — يكفي {fmt(daysCover)} يوم</p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => setMuted(true)}>
              <VolumeX className="w-4 h-4 ml-1" />تأكيد قراءة وإيقاف الصوت
            </Button>
          </div>
        </Card>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="رصيد العلف الحالي" value={`${fmt(balanceKg)} كجم`} highlight />
        <Kpi label="عدد الشكاير التقريبي" value={`${fmt(bagsApprox)} شيكارة`} sub={`وزن الشيكارة: ${fmt(bagWeight)} كجم`} />
        <Kpi label="الاستهلاك اليومي" value={`${fmt(dailyKg)} كجم/يوم`} sub={`${settings?.current_bird_count || 0} نعامة × ${fmt(Number(settings?.daily_consumption_per_bird_kg || 0))} كجم`} />
        <Kpi label="أيام التغطية" value={`${fmt(daysCover)} يوم`} sub={`الحد الأدنى: ${fmt(threshold)} كجم`} />
        <Kpi label="آخر توريد علف" value={balance?.last_supply_at ? format(new Date(balance.last_supply_at), "yyyy-MM-dd") : "—"} sub={balance?.last_supply_kg ? `${fmt(Number(balance.last_supply_kg))} كجم` : ""} />
        <Kpi label="آخر خصم استهلاك" value={balance?.last_consumption_day || "—"} sub={balance?.last_consumption_kg ? `${fmt(Number(balance.last_consumption_kg))} كجم` : ""} />
        <Kpi label="تاريخ بداية الاستهلاك" value={settings?.consumption_start_date || "—"} />
        <Kpi label="حالة العلف" value={status === "safe" ? "آمن" : status === "low" ? "منخفض" : "خطر"} positive={status === "safe"} negative={status !== "safe"} />
      </div>

      {/* Actions */}
      {canManage && (
        <div className="flex gap-2 flex-wrap">
          <AddSupplyDialog bagWeight={bagWeight} onSaved={() => { refetchBalance(); refetchMoves(); }} />
          <AdjustStockDialog onSaved={() => { refetchBalance(); refetchMoves(); }} />
        </div>
      )}

      {/* Movements log */}
      <Card className="p-4">
        <h3 className="font-bold mb-3">سجل حركات العلف</h3>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الشكاير</TableHead>
                <TableHead>الوزن (كجم)</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>السبب / ملاحظات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell>{m.movement_date}</TableCell>
                  <TableCell><MoveBadge type={m.movement_type} /></TableCell>
                  <TableCell>{m.bags ? fmt(Number(m.bags)) : "—"}</TableCell>
                  <TableCell className={m.movement_type === "in" || m.movement_type === "adjust_up" ? "text-green-700 font-bold" : "text-red-700 font-bold"}>
                    {(m.movement_type === "in" || m.movement_type === "adjust_up") ? "+" : "-"}{fmt(Number(m.weight_kg))}
                  </TableCell>
                  <TableCell>{m.supplier || "—"}</TableCell>
                  <TableCell className="text-xs">{m.reason || m.notes || "—"}</TableCell>
                </TableRow>
              ))}
              {movements.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">لا توجد حركات بعد</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, highlight, positive, negative }: any) {
  return (
    <Card className={`p-3 ${highlight ? "border-primary border-2" : ""}`}>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-bold ${negative ? "text-destructive" : positive ? "text-green-600" : ""}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}

function MoveBadge({ type }: { type: string }) {
  if (type === "in") return <Badge className="bg-green-600">وارد علف</Badge>;
  if (type === "daily_consumption") return <Badge variant="secondary">استهلاك يومي</Badge>;
  if (type === "adjust_up") return <Badge className="bg-blue-600">تسوية زيادة</Badge>;
  return <Badge variant="destructive">تسوية نقص</Badge>;
}

function AddSupplyDialog({ bagWeight, onSaved }: { bagWeight: number; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [bags, setBags] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [date, setDate] = useState<string>(todayCairo());
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");
  const [mode, setMode] = useState<"bags" | "kg">("bags");

  const computedKg = mode === "bags" ? (parseFloat(bags) || 0) * bagWeight : parseFloat(weight) || 0;

  const save = useMutation({
    mutationFn: async () => {
      if (computedKg <= 0) throw new Error("أدخل عدد شكاير أو وزن صحيح");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("mother_farm_feed_movements" as any).insert({
        movement_date: date,
        movement_type: "in",
        bags: mode === "bags" ? parseFloat(bags) || null : null,
        weight_kg: computedKg,
        supplier: supplier || null,
        notes: notes || null,
        created_by: u.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`تم تسجيل توريد ${fmt(computedKg)} كجم`);
      setOpen(false); setBags(""); setWeight(""); setSupplier(""); setNotes("");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="w-4 h-4 ml-1" />إضافة وارد علف</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>إضافة وارد علف جديد</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>طريقة الإدخال</Label>
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="bags">بعدد الشكاير (× {fmt(bagWeight)} كجم)</SelectItem>
                <SelectItem value="kg">بالكيلوجرام يدويًا</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "bags" ? (
            <div><Label>عدد الشكاير</Label><Input type="number" step="0.1" value={bags} onChange={(e) => setBags(e.target.value)} /></div>
          ) : (
            <div><Label>الوزن (كجم)</Label><Input type="number" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
          )}
          <div className="bg-muted p-2 rounded text-sm">الوزن الإجمالي: <strong>{fmt(computedKg)} كجم</strong></div>
          <div><Label>تاريخ التوريد</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>المورد</Label><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>
          <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ التوريد</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustStockDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"adjust_up" | "adjust_down">("adjust_up");
  const [kg, setKg] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayCairo());

  const save = useMutation({
    mutationFn: async () => {
      const w = parseFloat(kg);
      if (!w || w <= 0) throw new Error("أدخل وزن صحيح");
      if (!reason.trim()) throw new Error("سبب التسوية إجباري");
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("mother_farm_feed_movements" as any).insert({
        movement_date: date, movement_type: type, weight_kg: w, reason, created_by: u.user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تسجيل التسوية");
      setOpen(false); setKg(""); setReason("");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><Sliders className="w-4 h-4 ml-1" />تسوية رصيد</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>تسوية رصيد العلف</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>نوع التسوية</Label>
            <Select value={type} onValueChange={(v: any) => setType(v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="adjust_up">تسوية زيادة (+)</SelectItem>
                <SelectItem value="adjust_down">تسوية نقص (-)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>الوزن (كجم)</Label><Input type="number" step="0.1" value={kg} onChange={(e) => setKg(e.target.value)} /></div>
          <div><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>سبب التسوية (إجباري)</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: جرد فعلي، تلف، خطأ إدخال..." /></div>
        </div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ التسوية</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ settings, onSaved }: { settings: any; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});

  useEffect(() => {
    if (settings) setForm({
      bag_weight_kg: settings.bag_weight_kg,
      daily_consumption_per_bird_kg: settings.daily_consumption_per_bird_kg,
      low_stock_threshold_kg: settings.low_stock_threshold_kg,
      current_bird_count: settings.current_bird_count,
      consumption_start_date: settings.consumption_start_date,
      location_text: settings.location_text,
    });
  }, [settings, open]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("mother_farm_feed_settings" as any).update(form).eq("id", settings.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("تم تحديث الإعدادات"); setOpen(false); onSaved(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><SettingsIcon className="w-4 h-4 ml-1" />الإعدادات</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>إعدادات علف مزرعة الأمهات</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div><Label>وزن الشيكارة (كجم)</Label><Input type="number" step="0.1" value={form.bag_weight_kg ?? ""} onChange={(e) => setForm({ ...form, bag_weight_kg: parseFloat(e.target.value) })} /></div>
            <div><Label>استهلاك النعامة اليومي (كجم)</Label><Input type="number" step="0.1" value={form.daily_consumption_per_bird_kg ?? ""} onChange={(e) => setForm({ ...form, daily_consumption_per_bird_kg: parseFloat(e.target.value) })} /></div>
            <div><Label>حد التنبيه (كجم)</Label><Input type="number" step="1" value={form.low_stock_threshold_kg ?? ""} onChange={(e) => setForm({ ...form, low_stock_threshold_kg: parseFloat(e.target.value) })} /></div>
            <div><Label>عدد النعام الحالي</Label><Input type="number" value={form.current_bird_count ?? ""} onChange={(e) => setForm({ ...form, current_bird_count: parseInt(e.target.value) })} /></div>
          </div>
          <div><Label>تاريخ بداية الاستهلاك</Label><Input type="date" value={form.consumption_start_date ?? ""} onChange={(e) => setForm({ ...form, consumption_start_date: e.target.value })} /></div>
          <div><Label>الموقع</Label><Input value={form.location_text ?? ""} onChange={(e) => setForm({ ...form, location_text: e.target.value })} /></div>
          <p className="text-xs text-muted-foreground">⚠️ تغيير عدد النعام أو الاستهلاك يطبّق على الخصم اليومي القادم.</p>
        </div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>حفظ</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
