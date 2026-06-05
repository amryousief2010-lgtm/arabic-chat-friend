import { useEffect, useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Bird, Coins, Printer, FileSpreadsheet, FileText, Save, Settings as SettingsIcon, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";

type Worker = {
  id: string;
  full_name: string;
  role: string;
  lead_rank: number | null;
  monthly_base_salary: number;
  is_active: boolean;
};
type Settings = {
  id: string;
  bonus_threshold_birds: number;
  bonus_per_bird: number;
  lead_share_pct: number;
};
type BatchRow = {
  id: string;
  slaughter_date: string;
  birds_slaughtered: number;
  status: string;
  butcher_1_id: string | null;
  butcher_2_id: string | null;
  butcher_3_id: string | null;
};

const MONTHS_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

const ButchersPayroll = () => {
  const { role } = useAuth();
  const canManage = role === "general_manager" || role === "executive_manager" || role === "slaughterhouse_manager";

  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [monthIdx, setMonthIdx] = useState<number>(now.getMonth()); // 0-based

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editSalary, setEditSalary] = useState<Record<string, string>>({});
  const [editSettings, setEditSettings] = useState<Partial<Settings>>({});

  const loadAll = async () => {
    setLoading(true);
    const monthStr = String(monthIdx + 1).padStart(2, "0");
    const start = `${year}-${monthStr}-01`;
    const next = new Date(year, monthIdx + 1, 1);
    const endStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;

    const [{ data: w }, { data: s }, { data: b }] = await Promise.all([
      supabase.from("slaughter_workers").select("id,full_name,role,lead_rank,monthly_base_salary,is_active").eq("is_active", true).order("lead_rank", { ascending: true, nullsFirst: false }),
      supabase.from("slaughter_payroll_settings").select("*").limit(1).maybeSingle(),
      supabase.from("slaughter_batches")
        .select("id,slaughter_date,birds_slaughtered,status,butcher_1_id,butcher_2_id,butcher_3_id")
        .eq("status", "completed")
        .gte("slaughter_date", start)
        .lt("slaughter_date", endStr),
    ]);
    setWorkers((w as Worker[]) || []);
    setSettings((s as Settings) || null);
    setBatches((b as BatchRow[]) || []);
    setEditSettings({});
    setEditSalary({});
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [year, monthIdx]);

  const totalBirds = useMemo(() => batches.reduce((s, b) => s + (Number(b.birds_slaughtered) || 0), 0), [batches]);
  const threshold = settings?.bonus_threshold_birds ?? 30;
  const perBird = Number(settings?.bonus_per_bird ?? 100);
  const leadPct = Number(settings?.lead_share_pct ?? 50);
  const eligibleBirds = Math.max(0, totalBirds - threshold);
  const totalBonus = eligibleBirds * perBird;
  const leadBonus = totalBonus * (leadPct / 100);
  const remainingBonus = totalBonus - leadBonus;

  // count of batches each worker participated in
  const batchCountByWorker = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of batches) {
      for (const id of [b.butcher_1_id, b.butcher_2_id, b.butcher_3_id]) {
        if (id) map.set(id, (map.get(id) || 0) + 1);
      }
    }
    return map;
  }, [batches]);

  // Lead = worker with lead_rank=1; remaining = other active workers who participated this month
  const leadWorker = useMemo(() => workers.find(w => w.lead_rank === 1) || null, [workers]);
  const otherParticipants = useMemo(() => {
    return workers.filter(w => w.id !== leadWorker?.id && (batchCountByWorker.get(w.id) || 0) > 0);
  }, [workers, leadWorker, batchCountByWorker]);

  const rows = useMemo(() => {
    return workers.map(w => {
      const batchesCount = batchCountByWorker.get(w.id) || 0;
      let bonus = 0;
      if (totalBonus > 0) {
        if (w.id === leadWorker?.id) bonus = leadBonus;
        else if (otherParticipants.find(p => p.id === w.id)) bonus = otherParticipants.length > 0 ? remainingBonus / otherParticipants.length : 0;
      }
      return {
        ...w,
        batches_count: batchesCount,
        bonus,
        total_due: Number(w.monthly_base_salary || 0) + bonus,
      };
    });
  }, [workers, batchCountByWorker, leadWorker, otherParticipants, totalBonus, leadBonus, remainingBonus]);

  const saveSalary = async (id: string) => {
    const v = Number(editSalary[id]);
    if (Number.isNaN(v) || v < 0) { toast.error("راتب غير صالح"); return; }
    const { error } = await supabase.from("slaughter_workers").update({ monthly_base_salary: v }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم حفظ الراتب");
    loadAll();
  };

  const saveSettings = async () => {
    if (!settings) return;
    const payload = {
      bonus_threshold_birds: Number(editSettings.bonus_threshold_birds ?? settings.bonus_threshold_birds),
      bonus_per_bird: Number(editSettings.bonus_per_bird ?? settings.bonus_per_bird),
      lead_share_pct: Number(editSettings.lead_share_pct ?? settings.lead_share_pct),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("slaughter_payroll_settings").update(payload).eq("id", settings.id);
    if (error) { toast.error(error.message); return; }
    toast.success("تم تحديث قواعد البونص");
    loadAll();
  };

  const monthLabel = `${MONTHS_AR[monthIdx]} ${year}`;

  const exportExcel = () => {
    const data = rows.map(r => ({
      "الجزار": r.full_name,
      "الوظيفة": r.role,
      "الراتب الأساسي": Number(r.monthly_base_salary || 0),
      "دفعات شارك فيها": r.batches_count,
      "البونص": Number(r.bonus.toFixed(2)),
      "إجمالي المستحق": Number(r.total_due.toFixed(2)),
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "رواتب وبونص");
    XLSX.writeFile(wb, `رواتب-وبونص-الجزارين-${monthLabel}.xlsx`);
  };

  const printOrPdf = () => {
    const statsHtml = `
      <div class="stats">
        <div class="stat"><div class="k">الشهر</div><div class="v">${escapeHtml(monthLabel)}</div></div>
        <div class="stat"><div class="k">إجمالي النعام المذبوح</div><div class="v num">${fmtNum(totalBirds)}</div></div>
        <div class="stat"><div class="k">حد البونص</div><div class="v num">${fmtNum(threshold)}</div></div>
        <div class="stat"><div class="k">نعام مستحق للبونص</div><div class="v num">${fmtNum(eligibleBirds)}</div></div>
        <div class="stat"><div class="k">قيمة البونص للنعامة</div><div class="v num">${fmtNum(perBird)} ج</div></div>
        <div class="stat"><div class="k">إجمالي بونص الذبح</div><div class="v num">${fmtNum(totalBonus, 2)} ج</div></div>
        <div class="stat"><div class="k">نصيب الجزار الأول (${fmtNum(leadPct)}%)</div><div class="v num">${fmtNum(leadBonus, 2)} ج</div></div>
        <div class="stat"><div class="k">باقي البونص</div><div class="v num">${fmtNum(remainingBonus, 2)} ج</div></div>
      </div>`;
    const tableHtml = `
      <table>
        <thead><tr>
          <th>الجزار</th><th>الوظيفة</th><th>الراتب الأساسي</th>
          <th>دفعات شارك فيها</th><th>البونص</th><th>إجمالي المستحق</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${escapeHtml(r.full_name)}</td>
            <td>${escapeHtml(roleLabel(r.role, r.lead_rank))}</td>
            <td class="num">${fmtNum(Number(r.monthly_base_salary || 0), 2)}</td>
            <td class="num">${fmtNum(r.batches_count)}</td>
            <td class="num">${fmtNum(r.bonus, 2)}</td>
            <td class="num"><strong>${fmtNum(r.total_due, 2)}</strong></td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    const body = `
      <header>
        <div><h1>كشف رواتب وبونص الجزارين</h1><div class="en">Butchers Payroll & Bonus — ${escapeHtml(monthLabel)}</div></div>
        <div class="meta">${escapeHtml(new Date().toLocaleString("ar-EG"))}</div>
      </header>
      ${statsHtml}
      <h2>تفاصيل الجزارين</h2>
      ${tableHtml}
    `;
    openPrintWindow(`كشف رواتب وبونص — ${monthLabel}`, body);
  };

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1];
  }, []);

  return (
    <DashboardLayout>
      <Header title="رواتب وبونص الجزارين" subtitle="احتساب الراتب الأساسي + بونص الذبح الشهري" />
      <div className="p-4 md:p-6 space-y-6">
        {/* Period selector */}
        <Card>
          <CardContent className="pt-6 flex flex-wrap gap-4 items-end">
            <div>
              <Label>الشهر</Label>
              <Select value={String(monthIdx)} onValueChange={(v) => setMonthIdx(Number(v))}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS_AR.map((m, i) => <SelectItem key={i} value={String(i)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>السنة</Label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="ms-auto flex gap-2">
              <Button variant="outline" onClick={printOrPdf}><Printer className="w-4 h-4 ms-1" />طباعة / PDF</Button>
              <Button variant="outline" onClick={exportExcel}><FileSpreadsheet className="w-4 h-4 ms-1" />Excel</Button>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard icon={Bird} title="إجمالي النعام المذبوح" value={fmtNum(totalBirds)} />
          <KpiCard icon={Bird} title={`نعام مستحق للبونص (فوق ${threshold})`} value={fmtNum(eligibleBirds)} />
          <KpiCard icon={Coins} title={`قيمة البونص للنعامة`} value={`${fmtNum(perBird)} ج`} />
          <KpiCard icon={Coins} title="إجمالي بونص الذبح" value={`${fmtNum(totalBonus, 2)} ج`} highlight />
        </div>

        {/* Bonus distribution summary */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />توزيع بونص الذبح</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>• نصيب الجزار الأول ({leadWorker?.full_name || "—"}) = <strong>{fmtNum(leadPct)}%</strong> من إجمالي البونص = <strong>{fmtNum(leadBonus, 2)} ج</strong></div>
            <div>• الباقي = <strong>{fmtNum(remainingBonus, 2)} ج</strong> يقسم بالتساوي على باقي الجزارين المشاركين هذا الشهر ({otherParticipants.length}).</div>
            {otherParticipants.length > 0 && (
              <div className="text-muted-foreground">• نصيب كل واحد منهم = <strong>{fmtNum(remainingBonus / otherParticipants.length, 2)} ج</strong></div>
            )}
            {totalBonus === 0 && <div className="text-muted-foreground">لا يوجد بونص هذا الشهر (لم يتم تجاوز حد {threshold} نعامة).</div>}
          </CardContent>
        </Card>

        {/* Payroll table */}
        <Card>
          <CardHeader><CardTitle className="text-base">كشف الجزارين</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الجزار</TableHead>
                  <TableHead>الوظيفة</TableHead>
                  <TableHead>الراتب الأساسي</TableHead>
                  <TableHead>دفعات شارك فيها</TableHead>
                  <TableHead>البونص</TableHead>
                  <TableHead>إجمالي المستحق</TableHead>
                  {canManage && <TableHead>إجراء</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={canManage ? 7 : 6} className="text-center text-muted-foreground">جاري التحميل…</TableCell></TableRow>
                ) : rows.length === 0 ? (
                  <TableRow><TableCell colSpan={canManage ? 7 : 6} className="text-center text-muted-foreground">لا يوجد جزارين نشطين</TableCell></TableRow>
                ) : rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.full_name}</TableCell>
                    <TableCell>
                      {roleLabel(r.role, r.lead_rank)}
                      {r.id === leadWorker?.id && <Badge variant="secondary" className="ms-2">نصيب {fmtNum(leadPct)}%</Badge>}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Input
                          type="number"
                          className="w-32 inline-block"
                          value={editSalary[r.id] ?? String(r.monthly_base_salary || 0)}
                          onChange={(e) => setEditSalary(s => ({ ...s, [r.id]: e.target.value }))}
                        />
                      ) : (
                        <span className="num">{fmtNum(Number(r.monthly_base_salary || 0), 2)} ج</span>
                      )}
                    </TableCell>
                    <TableCell className="num">{fmtNum(r.batches_count)}</TableCell>
                    <TableCell className="num">{fmtNum(r.bonus, 2)} ج</TableCell>
                    <TableCell className="num font-bold">{fmtNum(r.total_due, 2)} ج</TableCell>
                    {canManage && (
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => saveSalary(r.id)} disabled={editSalary[r.id] === undefined}>
                          <Save className="w-3 h-3 ms-1" />حفظ
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Settings */}
        {canManage && settings && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><SettingsIcon className="w-4 h-4" />قواعد البونص</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <Label>حد البونص (عدد النعام)</Label>
                <Input type="number" value={editSettings.bonus_threshold_birds ?? settings.bonus_threshold_birds}
                       onChange={(e) => setEditSettings(s => ({ ...s, bonus_threshold_birds: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>قيمة البونص للنعامة (ج)</Label>
                <Input type="number" value={editSettings.bonus_per_bird ?? settings.bonus_per_bird}
                       onChange={(e) => setEditSettings(s => ({ ...s, bonus_per_bird: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>نسبة الجزار الأول (%)</Label>
                <Input type="number" value={editSettings.lead_share_pct ?? settings.lead_share_pct}
                       onChange={(e) => setEditSettings(s => ({ ...s, lead_share_pct: Number(e.target.value) }))} />
              </div>
              <Button onClick={saveSettings} disabled={Object.keys(editSettings).length === 0}>
                <Save className="w-4 h-4 ms-1" />حفظ القواعد
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

const roleLabel = (role: string, leadRank: number | null) => {
  if (leadRank === 1) return "جزار مسؤول أول";
  if (leadRank === 2) return "جزار مسؤول ثاني";
  if (leadRank === 3) return "جزار مسؤول ثالث";
  return role === "supervisor" ? "جزار مسؤول" : role;
};

const KpiCard = ({ icon: Icon, title, value, highlight }: { icon: any; title: string; value: string; highlight?: boolean }) => (
  <Card className={highlight ? "border-primary/40" : ""}>
    <CardContent className="pt-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="text-2xl font-bold mt-1">{value}</div>
        </div>
        <Icon className={`w-8 h-8 ${highlight ? "text-primary" : "text-muted-foreground"}`} />
      </div>
    </CardContent>
  </Card>
);

export default ButchersPayroll;
