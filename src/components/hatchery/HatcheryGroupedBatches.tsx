import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Printer, FileSpreadsheet, Eye } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";
import * as XLSX from "xlsx";

// row[] is the same shape produced by BatchesTab.rows (id, batch_number, entry_date, machine,
// type, customer_name, total_eggs, net_eggs, chicks, candle1_date, candle2_date, exit_date,
// status, stage, expCandle1, expCandle2, expExit, daysIn, is_imported, _raw{...})

type StageMeta = { label: string; color: string };

interface Props {
  rows: any[];
  stageMeta: Record<string, StageMeta>;
  todayStr: string;
}

const pct = (num: number, den: number) =>
  den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "—";

const groupKey = (r: any) => `${r.entry_date || "—"}__${(r.machine || "—").trim()}`;

const addDaysISO = (iso: string, days: number) => {
  if (!iso) return "";
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const HatcheryGroupedBatches = ({ rows, stageMeta, todayStr }: Props) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    | "all" | "external" | "internal" | "in_progress" | "completed" | "overdue"
    | "exited" | "candle2_today" | "exit_in_3"
  >("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [machineFilter, setMachineFilter] = useState("all");
  const [openGroup, setOpenGroup] = useState<any>(null);

  const groups = useMemo(() => {
    const map = new Map<string, any>();
    rows.forEach((r) => {
      // Prefer batch_number as operational key when it represents a single cycle;
      // fall back to entry_date + machine.
      const key = r.batch_number
        ? `BN__${r.batch_number}`
        : groupKey(r);
      if (!map.has(key)) {
        map.set(key, {
          key,
          entry_date: r.entry_date,
          machine: r.machine,
          batch_numbers: new Set<string>(),
          customers: [] as any[],
          total_eggs: 0,
          net_eggs: 0,
          chicks: 0,
          internal_eggs: 0,
          external_eggs: 0,
          internal_chicks: 0,
          external_chicks: 0,
          c1_fertile: 0,
          c1_infertile: 0,
          c2_fertile: 0,
          c2_dead: 0,
          hatcher_dead: 0,
          candle1_dates: new Set<string>(),
          candle2_dates: new Set<string>(),
          exit_dates: new Set<string>(),
          expCandle1: r.expCandle1,
          expCandle2: r.expCandle2,
          expExit: r.expExit,
          stages: [] as string[],
          has_external: false,
          has_internal: false,
          is_imported: false,
        });
      }
      const g = map.get(key);
      g.batch_numbers.add(r.batch_number);
      g.customers.push(r);
      g.total_eggs += r.total_eggs || 0;
      g.net_eggs += r.net_eggs || 0;
      g.chicks += r.chicks || 0;
      if (r.type === "internal") {
        g.internal_eggs += r.total_eggs || 0;
        g.internal_chicks += r.chicks || 0;
        g.has_internal = true;
      } else {
        g.external_eggs += r.total_eggs || 0;
        g.external_chicks += r.chicks || 0;
        g.has_external = true;
      }
      g.c1_fertile += r._raw?.candle1_fertile || 0;
      g.c1_infertile += r._raw?.candle1_infertile || 0;
      g.c2_fertile += r._raw?.candle2_fertile || 0;
      g.c2_dead += r._raw?.candle2_dead || 0;
      g.hatcher_dead += r._raw?.hatcher_dead || 0;
      if (r.candle1_date) g.candle1_dates.add(r.candle1_date);
      if (r.candle2_date) g.candle2_dates.add(r.candle2_date);
      if (r.exit_date) g.exit_dates.add(r.exit_date);
      g.stages.push(r.stage);
      if (r.is_imported) g.is_imported = true;
    });

    const arr = Array.from(map.values()).map((g) => {
      const allCompleted = g.stages.every((s: string) => s === "completed");
      const anyOverdue = g.stages.some((s: string) => s === "overdue");
      const stage = anyOverdue ? "overdue" : allCompleted ? "completed" : "in_progress";
      const bnArr = Array.from(g.batch_numbers).filter(Boolean);
      const op_number =
        bnArr.length === 1
          ? String(bnArr[0])
          : `${g.entry_date || "—"} / ${g.machine || "—"}`;
      const fmtDates = (s: Set<string>) =>
        s.size === 0 ? null : Array.from(s).sort().join(" / ");
      const exited = g.exit_dates.size > 0 && allCompleted;
      const expectedExit = g.expExit || addDaysISO(g.entry_date, 42);
      return {
        ...g,
        op_number,
        stage,
        exited,
        expectedExit,
        candle1_display: fmtDates(g.candle1_dates),
        candle2_display: fmtDates(g.candle2_dates),
        exit_display: fmtDates(g.exit_dates),
        fertility: pct(g.c1_fertile, g.total_eggs),
        hatch_rate: pct(g.chicks, g.total_eggs),
      };
    });

    arr.sort((a, b) => String(b.entry_date || "").localeCompare(String(a.entry_date || "")));
    return arr;
  }, [rows]);

  const machineOptions = useMemo(() => {
    const s = new Set<string>();
    groups.forEach((g) => g.machine && s.add(g.machine));
    return Array.from(s).sort();
  }, [groups]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const today = todayStr;
    const in3 = addDaysISO(today, 3);
    return groups.filter((g) => {
      if (filter === "external" && !g.has_external) return false;
      if (filter === "internal" && !g.has_internal) return false;
      if (filter === "completed" && g.stage !== "completed") return false;
      if (filter === "in_progress" && g.stage !== "in_progress") return false;
      if (filter === "overdue" && g.stage !== "overdue") return false;
      if (filter === "exited" && !g.exited) return false;
      if (filter === "candle2_today") {
        const c2 = g.candle2_display || g.expCandle2;
        if (!c2 || !String(c2).includes(today)) return false;
      }
      if (filter === "exit_in_3") {
        const ex = g.expectedExit;
        if (!ex || g.exited) return false;
        if (!(ex >= today && ex <= in3)) return false;
      }
      if (machineFilter !== "all" && g.machine !== machineFilter) return false;
      if (fromDate && (g.entry_date || "") < fromDate) return false;
      if (toDate && (g.entry_date || "") > toDate) return false;
      if (!q) return true;
      if ((g.machine || "").toLowerCase().includes(q)) return true;
      if ((g.entry_date || "").includes(q)) return true;
      if (g.customers.some((c: any) => (c.customer_name || "").toLowerCase().includes(q)))
        return true;
      if (Array.from(g.batch_numbers).some((n: any) => String(n).toLowerCase().includes(q)))
        return true;
      return false;
    });
  }, [groups, search, filter, fromDate, toDate, machineFilter, todayStr]);

  const counts = useMemo(
    () => ({
      all: groups.length,
      external: groups.filter((g) => g.has_external).length,
      internal: groups.filter((g) => g.has_internal).length,
      in_progress: groups.filter((g) => g.stage === "in_progress").length,
      completed: groups.filter((g) => g.stage === "completed").length,
      overdue: groups.filter((g) => g.stage === "overdue").length,
      exited: groups.filter((g) => g.exited).length,
    }),
    [groups]
  );

  const FilterBtn = ({ k, label, n, tone }: any) => (
    <Button
      size="sm"
      variant={filter === k ? "default" : "outline"}
      onClick={() => setFilter(k)}
      className={tone}
    >
      {label}{" "}
      {typeof n === "number" && (
        <Badge variant="secondary" className="mr-2 text-[10px]">
          {n}
        </Badge>
      )}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث: رقم دفعة / عميل / ماكينة / تاريخ..."
            className="pr-9"
          />
        </div>
        <Input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="w-[150px]"
          placeholder="من"
        />
        <Input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="w-[150px]"
          placeholder="إلى"
        />
        <select
          value={machineFilter}
          onChange={(e) => setMachineFilter(e.target.value)}
          className="border rounded-md px-2 py-1 text-sm bg-background"
        >
          <option value="all">كل الماكينات</option>
          {machineOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        {(fromDate || toDate || machineFilter !== "all" || search) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setFromDate("");
              setToDate("");
              setMachineFilter("all");
              setSearch("");
            }}
          >
            مسح الفلاتر
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterBtn k="all" label="الكل" n={counts.all} />
        <FilterBtn k="external" label="بها عملاء خارجيين" n={counts.external} />
        <FilterBtn k="internal" label="بها نعام العاصمة" n={counts.internal} />
        <FilterBtn k="in_progress" label="جارية" n={counts.in_progress} />
        <FilterBtn k="completed" label="مكتملة" n={counts.completed} />
        <FilterBtn k="exited" label="خرجت" n={counts.exited} />
        <FilterBtn k="overdue" label="متأخرة" n={counts.overdue} tone="text-red-600" />
        <FilterBtn k="candle2_today" label="كشف 2 اليوم" />
        <FilterBtn k="exit_in_3" label="خروج خلال 3 أيام" />
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الدفعة التشغيلية</TableHead>
              <TableHead>تاريخ الدخول</TableHead>
              <TableHead>الماكينة</TableHead>
              <TableHead>عدد العملاء</TableHead>
              <TableHead>بيض العاصمة</TableHead>
              <TableHead>بيض الخارجي</TableHead>
              <TableHead>إجمالي البيض</TableHead>
              <TableHead>إجمالي الكتاكيت</TableHead>
              <TableHead>كشف 1</TableHead>
              <TableHead>كشف 2</TableHead>
              <TableHead>الخروج</TableHead>
              <TableHead>المرحلة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((g) => {
              const meta =
                stageMeta[g.stage] || { label: g.stage, color: "bg-gray-500" };
              return (
                <TableRow
                  key={g.key}
                  className={
                    g.stage === "overdue"
                      ? "bg-red-50/40 dark:bg-red-950/20 cursor-pointer"
                      : "cursor-pointer hover:bg-muted/40"
                  }
                  onClick={() => setOpenGroup(g)}
                >
                  <TableCell className="font-mono text-xs">
                    {g.op_number}
                    {g.is_imported && (
                      <Badge variant="outline" className="mr-1 text-[9px]">
                        مستوردة
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{g.entry_date || "—"}</TableCell>
                  <TableCell className="text-xs">{g.machine || "—"}</TableCell>
                  <TableCell className="text-center font-bold">
                    {g.customers.length}
                  </TableCell>
                  <TableCell className="text-xs">{fmtNum(g.internal_eggs)}</TableCell>
                  <TableCell className="text-xs">{fmtNum(g.external_eggs)}</TableCell>
                  <TableCell className="font-bold">{fmtNum(g.total_eggs)}</TableCell>
                  <TableCell>{fmtNum(g.chicks)}</TableCell>
                  <TableCell className="text-xs">
                    {g.candle1_display || (
                      <span className="text-muted-foreground">
                        {g.expCandle1 ? `~${g.expCandle1}` : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {g.candle2_display || (
                      <span className="text-muted-foreground">
                        {g.expCandle2 ? `~${g.expCandle2}` : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {g.exit_display ? (
                      <span className="text-green-700 font-medium">{g.exit_display}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        {g.expectedExit ? `متوقع ~${g.expectedExit}` : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge className={`${meta.color} text-white whitespace-nowrap`}>
                        {meta.label}
                      </Badge>
                      {g.exited ? (
                        <Badge variant="outline" className="text-[9px] text-green-700 border-green-300">خرجت</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] text-amber-700 border-amber-300">لم تخرج</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setOpenGroup(g)}>
                        <Eye className="w-3 h-3 ml-1" /> تفاصيل
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => printGroup(g)}>
                        <Printer className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => exportGroupExcel(g)}>
                        <FileSpreadsheet className="w-3 h-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                  لا توجد دفعات تشغيلية مطابقة
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {openGroup && (
        <GroupDetailDialog
          group={openGroup}
          stageMeta={stageMeta}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  );
};

// ============== Group Detail Dialog ==============
const GroupDetailDialog = ({ group, stageMeta, onClose }: any) => {
  const meta = stageMeta[group.stage] || { label: group.stage, color: "bg-gray-500" };
  const Row = ({ label, value }: { label: string; value: any }) => (
    <div className="flex justify-between border-b py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? "—"}</span>
    </div>
  );
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            دفعة تشغيلية: {group.op_number}
            <Badge className={`${meta.color} text-white`}>{meta.label}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">ملخص الدفعة</h4>
            <Row label="تاريخ الدخول" value={group.entry_date} />
            <Row label="الماكينة" value={group.machine} />
            <Row label="الكشف الأول" value={group.candle1_display || `~${group.expCandle1 || "—"}`} />
            <Row label="الكشف الثاني" value={group.candle2_display || `~${group.expCandle2 || "—"}`} />
            <Row label="الخروج/الهاتشر" value={group.exit_display || `~${group.expExit || "—"}`} />
            <Row label="عدد دفعات العملاء" value={group.customers.length} />
            <Row label="أرقام الدفعات" value={Array.from(group.batch_numbers).join(", ")} />
          </Card>
          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">الإجماليات</h4>
            <Row label="إجمالي البيض" value={fmtNum(group.total_eggs)} />
            <Row label="إجمالي الصافي" value={fmtNum(group.net_eggs)} />
            <Row label="إجمالي الكتاكيت" value={fmtNum(group.chicks)} />
            <Row label="نسبة الخصوبة العامة" value={group.fertility} />
            <Row label="نسبة الفقس العامة" value={group.hatch_rate} />
            <Row label="نافق هاتشر" value={fmtNum(group.hatcher_dead)} />
          </Card>
        </div>

        <Card className="mt-2 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>رقم دفعة العميل</TableHead>
                <TableHead>بيض</TableHead>
                <TableHead>تالف</TableHead>
                <TableHead>صافي</TableHead>
                <TableHead>لايح</TableHead>
                <TableHead>مخصب 1</TableHead>
                <TableHead>نافق ك2</TableHead>
                <TableHead>نافق هاتشر</TableHead>
                <TableHead>كتاكيت</TableHead>
                <TableHead>% فقس</TableHead>
                <TableHead>الحساب التقديري</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.customers.map((c: any) => {
                const raw = c._raw || {};
                const damaged = (raw.received_eggs || 0) - (raw.net_eggs || 0);
                const rate = pct(c.chicks, c.total_eggs);
                const charge = raw.charge_total ?? "—";
                return (
                  <TableRow key={c.id}>
                    <TableCell className="text-xs font-medium">{c.customer_name}</TableCell>
                    <TableCell className="text-xs">
                      {c.type === "internal" ? "عاصمة" : "خارجي"}
                    </TableCell>
                    <TableCell className="text-xs font-mono">{c.batch_number}</TableCell>
                    <TableCell>{fmtNum(c.total_eggs)}</TableCell>
                    <TableCell>{fmtNum(damaged)}</TableCell>
                    <TableCell>{fmtNum(c.net_eggs)}</TableCell>
                    <TableCell>{fmtNum(raw.candle1_infertile)}</TableCell>
                    <TableCell>{fmtNum(raw.candle1_fertile)}</TableCell>
                    <TableCell>{fmtNum(raw.candle2_dead)}</TableCell>
                    <TableCell>{fmtNum(raw.hatcher_dead)}</TableCell>
                    <TableCell className="font-bold">{fmtNum(c.chicks)}</TableCell>
                    <TableCell className="text-xs">{rate}</TableCell>
                    <TableCell className="text-xs">
                      {c.type === "internal" ? (
                        <span className="text-muted-foreground">داخلي</span>
                      ) : (
                        charge
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button variant="outline" onClick={() => exportGroupExcel(group)}>
            <FileSpreadsheet className="w-4 h-4 ml-1" /> تصدير Excel
          </Button>
          <Button onClick={() => printGroup(group)}>
            <Printer className="w-4 h-4 ml-1" /> طباعة تقرير الدفعة التشغيلية
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ============== Excel Export ==============
function exportGroupExcel(g: any) {
  const rows = g.customers.map((c: any) => {
    const raw = c._raw || {};
    return {
      "العميل": c.customer_name,
      "النوع": c.type === "internal" ? "عاصمة" : "خارجي",
      "رقم الدفعة": c.batch_number,
      "البيض الوارد": c.total_eggs,
      "التالف": (raw.received_eggs || 0) - (raw.net_eggs || 0),
      "الصافي": c.net_eggs,
      "لايح (ك1)": raw.candle1_infertile || 0,
      "مخصب (ك1)": raw.candle1_fertile || 0,
      "نافق كشف 2": raw.candle2_dead || 0,
      "نافق هاتشر": raw.hatcher_dead || 0,
      "الكتاكيت": c.chicks,
      "نسبة الفقس": pct(c.chicks, c.total_eggs),
      "ملاحظات": raw.notes || "",
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Customers");
  const fileName = `operational_batch_${g.entry_date || "x"}_${(g.machine || "x").replace(/\s+/g, "_")}.xlsx`;
  XLSX.writeFile(wb, fileName);
}

// ============== Print Report ==============
function printGroup(g: any) {
  const customersHtml = g.customers
    .map((c: any) => {
      const raw = c._raw || {};
      const damaged = (raw.received_eggs || 0) - (raw.net_eggs || 0);
      return `<tr>
        <td>${escapeHtml(c.customer_name)}</td>
        <td>${c.type === "internal" ? "عاصمة" : "خارجي"}</td>
        <td>${escapeHtml(c.batch_number || "")}</td>
        <td>${fmtNum(c.total_eggs)}</td>
        <td>${fmtNum(damaged)}</td>
        <td>${fmtNum(c.net_eggs)}</td>
        <td>${fmtNum(raw.candle1_infertile)}</td>
        <td>${fmtNum(raw.candle1_fertile)}</td>
        <td>${fmtNum(raw.candle2_dead)}</td>
        <td>${fmtNum(raw.hatcher_dead)}</td>
        <td><b>${fmtNum(c.chicks)}</b></td>
        <td>${pct(c.chicks, c.total_eggs)}</td>
      </tr>`;
    })
    .join("");

  const html = `
    <div style="text-align:center;margin-bottom:12px">
      <h1 style="margin:0;color:#7c3aed">نعام العاصمة — معمل التفريخ والحضانات</h1>
      <h2 style="margin:4px 0;color:#ea580c">تقرير دفعة تشغيلية</h2>
    </div>
    <table class="info">
      <tr><td><b>رقم الدفعة:</b> ${escapeHtml(g.op_number)}</td><td><b>الماكينة:</b> ${escapeHtml(g.machine || "—")}</td></tr>
      <tr><td><b>تاريخ الدخول:</b> ${escapeHtml(g.entry_date || "—")}</td><td><b>المرحلة:</b> ${escapeHtml(g.stage)}</td></tr>
      <tr><td><b>الكشف الأول:</b> ${escapeHtml(g.candle1_display || g.expCandle1 || "—")}</td>
          <td><b>الكشف الثاني:</b> ${escapeHtml(g.candle2_display || g.expCandle2 || "—")}</td></tr>
      <tr><td><b>الخروج/الهاتشر:</b> ${escapeHtml(g.exit_display || g.expExit || "—")}</td>
          <td><b>عدد العملاء:</b> ${g.customers.length}</td></tr>
      <tr><td><b>إجمالي البيض:</b> ${fmtNum(g.total_eggs)}</td>
          <td><b>إجمالي الكتاكيت:</b> ${fmtNum(g.chicks)}</td></tr>
      <tr><td><b>نسبة الخصوبة:</b> ${g.fertility}</td>
          <td><b>نسبة الفقس:</b> ${g.hatch_rate}</td></tr>
    </table>

    <h3 style="margin-top:18px;color:#7c3aed">تفاصيل العملاء داخل الدفعة</h3>
    <table class="data">
      <thead>
        <tr>
          <th>العميل</th><th>النوع</th><th>رقم الدفعة</th>
          <th>البيض</th><th>التالف</th><th>الصافي</th>
          <th>لايح</th><th>مخصب 1</th><th>نافق ك2</th><th>نافق هاتشر</th>
          <th>الكتاكيت</th><th>% فقس</th>
        </tr>
      </thead>
      <tbody>${customersHtml}</tbody>
      <tfoot>
        <tr>
          <th colspan="3">الإجمالي</th>
          <th>${fmtNum(g.total_eggs)}</th>
          <th>${fmtNum(g.total_eggs - g.net_eggs)}</th>
          <th>${fmtNum(g.net_eggs)}</th>
          <th>${fmtNum(g.c1_infertile)}</th>
          <th>${fmtNum(g.c1_fertile)}</th>
          <th>${fmtNum(g.c2_dead)}</th>
          <th>${fmtNum(g.hatcher_dead)}</th>
          <th>${fmtNum(g.chicks)}</th>
          <th>${g.hatch_rate}</th>
        </tr>
      </tfoot>
    </table>

    <div style="margin-top:30px;display:flex;justify-content:space-between">
      <div>التوقيع: ____________________</div>
      <div>تاريخ الطباعة: ${new Date().toLocaleString("ar-EG")}</div>
    </div>

    <style>
      table.info { width:100%; border-collapse:collapse; margin-top:8px }
      table.info td { padding:6px 8px; border:1px solid #ddd; font-size:13px }
      table.data { width:100%; border-collapse:collapse; margin-top:8px }
      table.data th, table.data td { padding:6px; border:1px solid #ccc; font-size:12px; text-align:center }
      table.data thead th { background:#7c3aed; color:#fff }
      table.data tfoot th { background:#f3f4f6 }
    </style>
  `;

  openPrintWindow(`تقرير دفعة تشغيلية - ${g.op_number}`, html);

}

export default HatcheryGroupedBatches;
