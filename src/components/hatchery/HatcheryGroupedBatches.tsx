import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, Printer, FileSpreadsheet, Eye, Sparkles, Pencil, Plus, Lock, Wallet } from "lucide-react";
import { openPrintWindow, escapeHtml, fmtNum } from "@/lib/printPdf";
import * as XLSX from "xlsx";
import HatchResultsEntryDialog from "./HatchResultsEntryDialog";
import HatchBatchRowEditDialog from "./HatchBatchRowEditDialog";
import BatchAddEggsDialog from "./BatchAddEggsDialog";
import BatchAccountDialog from "./BatchAccountDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// row[] is the same shape produced by BatchesTab.rows (id, batch_number, entry_date, machine,
// type, customer_name, total_eggs, net_eggs, chicks, candle1_date, candle2_date, exit_date,
// status, stage, expCandle1, expCandle2, expExit, daysIn, is_imported, _raw{...})

type StageMeta = { label: string; color: string };

interface Props {
  rows: any[];
  stageMeta: Record<string, StageMeta>;
  todayStr: string;
  sortOrder?: "asc" | "desc";
  onRefresh?: () => void;
}

const pct = (num: number, den: number) =>
  den > 0 ? ((num / den) * 100).toFixed(1) + "%" : "—";

const groupKey = (r: any) =>
  r.op_seq != null
    ? `OP__${(r.machine || "—").trim()}__${r.op_seq}`
    : `DATE__${r.entry_date || "—"}__${(r.machine || "—").trim()}`;

const addDaysISO = (iso: string, days: number) => {
  if (!iso) return "";
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const HatcheryGroupedBatches = ({ rows, stageMeta, todayStr, sortOrder = "asc", onRefresh }: Props) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    | "all" | "external" | "internal" | "in_progress" | "completed" | "overdue"
    | "exited" | "candle2_today" | "exit_in_3" | "in_hatcher"
  >("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [machineFilter, setMachineFilter] = useState("all");
  const [openGroup, setOpenGroup] = useState<any>(null);
  const [resultsGroup, setResultsGroup] = useState<any>(null);

  const groups = useMemo(() => {
    const map = new Map<string, any>();
    rows.forEach((r) => {
      // One operational batch = same entry_date + same machine.
      // All customer rows that share these two values collapse into ONE row.
      const key = groupKey(r);
      if (!map.has(key)) {
        map.set(key, {
          key,
          entry_date: r.entry_date,
          machine: r.machine,
          op_seq: r.op_seq ?? null,
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
      if (g.op_seq == null && r.op_seq != null) g.op_seq = r.op_seq;
      if (!g.entry_date && r.entry_date) g.entry_date = r.entry_date;
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
      const anyInHatcher = g.stages.some((s: string) => s === "in_hatcher");
      const anyOverdue = g.stages.some((s: string) => s === "overdue");
      const stage = anyOverdue
        ? "overdue"
        : allCompleted
          ? "completed"
          : anyInHatcher
            ? "in_hatcher"
            : "in_progress";
      const fmtDates = (s: Set<string>) =>
        s.size === 0 ? null : Array.from(s).sort().join(" / ");
      const exited = g.exit_dates.size > 0 && allCompleted;
      const expectedExit = g.expExit || addDaysISO(g.entry_date, 42);
      return {
        ...g,
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

    // Operational batch number: prefer real sheet number (op_seq from DB);
    // otherwise fall back to per-machine rank by entry_date asc.
    const perMachine = new Map<string, string[]>();
    arr.forEach((g) => {
      if (g.op_seq != null) return;
      const m = g.machine || "—";
      if (!perMachine.has(m)) perMachine.set(m, []);
      perMachine.get(m)!.push(g.entry_date || "");
    });
    perMachine.forEach((dates) => dates.sort());
    arr.forEach((g) => {
      const m = g.machine || "—";
      const seq =
        g.op_seq != null
          ? g.op_seq
          : (perMachine.get(m) || []).indexOf(g.entry_date || "") + 1;
      g.op_seq = seq;
      g.op_number = `دفعة ${seq}${g.machine ? ` — ${g.machine}` : ""}`;
    });

    // Sort primarily by operational batch number, then case-insensitive by machine.
    const dir = sortOrder === "desc" ? -1 : 1;
    arr.sort((a, b) => {
      const seqDiff = (a.op_seq || 0) - (b.op_seq || 0);
      if (seqDiff !== 0) return dir * seqDiff;
      return String(a.machine || "").toLowerCase().localeCompare(String(b.machine || "").toLowerCase());
    });
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
      if (filter === "in_hatcher" && g.stage !== "in_hatcher") return false;
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
      in_hatcher: groups.filter((g) => g.stage === "in_hatcher").length,
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
        <FilterBtn k="completed" label="مكتملة / خرجت" n={counts.completed} tone="text-emerald-700" />
        <FilterBtn k="in_hatcher" label="في الهاتشر" n={counts.in_hatcher} tone="text-purple-700" />
        <FilterBtn k="in_progress" label="قادمة" n={counts.in_progress} />
        <FilterBtn k="overdue" label="متأخرة" n={counts.overdue} tone="text-red-600" />
        <FilterBtn k="exited" label="تم حساب العملاء عليها" n={counts.exited} tone="text-emerald-700" />
        <FilterBtn k="external" label="بها عملاء خارجيين" n={counts.external} />
        <FilterBtn k="internal" label="بها نعام العاصمة" n={counts.internal} />
        <FilterBtn k="candle2_today" label="كشف 2 اليوم" />
        <FilterBtn k="exit_in_3" label="خروج خلال 3 أيام" />
      </div>

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>رقم الدفعة</TableHead>
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
                      : g.stage === "in_hatcher"
                        ? "bg-purple-50/60 dark:bg-purple-950/20 cursor-pointer hover:bg-purple-100/60"
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
                    <div className="flex gap-1 flex-wrap">
                      {(() => {
                        const hasResults = g.chicks > 0 || g.c1_fertile > 0 || g.c2_fertile > 0 || g.exit_dates.size > 0;
                        const isLocked = g.stage === "completed" && g.exited && hasResults;
                        const label = isLocked
                          ? "عرض نتائج الفقس"
                          : hasResults
                            ? "تعديل نتائج الفقس"
                            : "إدخال نتائج الفقس";
                        return (
                          <Button
                            size="sm"
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            onClick={() => setResultsGroup(g)}
                          >
                            <Sparkles className="w-3 h-3 ml-1" />
                            {label}
                          </Button>
                        );
                      })()}

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
                <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
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
          onOpenResults={(g: any) => { setOpenGroup(null); setResultsGroup(g); }}
          onRefresh={onRefresh}
        />
      )}
      {resultsGroup && (
        <HatchResultsEntryDialog
          group={resultsGroup}
          onClose={() => setResultsGroup(null)}
          onSaved={() => onRefresh?.()}
        />
      )}
    </div>
  );
};

// ============== Group Detail Dialog ==============
const GroupDetailDialog = ({ group, stageMeta, onClose, onOpenResults, onRefresh }: any) => {
  const [editRow, setEditRow] = useState<any>(null);
  const [addEggsOpen, setAddEggsOpen] = useState(false);
  const [accountLotId, setAccountLotId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string>("");
  const [openingAccount, setOpeningAccount] = useState<string | null>(null);
  const opNo = Number(group.op_seq ?? 0);
  const accountsEnabled = opNo >= 18;

  const openCustomerAccount = async (c: any) => {
    if (!accountsEnabled) {
      toast.error("حسابات العملاء متاحة فقط للدفعات من رقم 18 وما بعدها");
      return;
    }
    if (!c._raw?.customer_id) {
      toast.error("لا يوجد عميل مرتبط بهذا الصف");
      return;
    }
    setOpeningAccount(c.id);
    const { data, error } = await supabase.rpc("ensure_hatch_batch_lot" as any, { p_hatch_batch_id: c.id });
    setOpeningAccount(null);
    if (error) { toast.error(error.message); return; }
    setAccountLotId(data as unknown as string);
    setAccountName(c.customer_name || "عميل");
  };
  const meta = stageMeta[group.stage] || { label: group.stage, color: "bg-gray-500" };
  // Batch is "locked" ONLY once explicitly closed (status = closed/completed).
  // Saving partial hatch results no longer locks the batch.
  const locked = (group.customers || []).some((c: any) => {
    const r = c._raw || {};
    return r.status === "closed" || r.status === "completed";
  });
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
            {locked && (
              <Badge variant="outline" className="text-red-700 border-red-300">
                <Lock className="w-3 h-3 ml-1" /> مقفلة
              </Badge>
            )}
            <div className="mr-auto flex gap-2 flex-wrap">
              {!locked && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-purple-300 text-purple-700 hover:bg-purple-50"
                  onClick={() => setAddEggsOpen(true)}
                >
                  <Plus className="w-3 h-3 ml-1" /> إضافة بيض للدفعة
                </Button>
              )}
              {(group.stage === "in_hatcher" || group.stage === "completed") && onOpenResults && (
                <Button
                  size="sm"
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={() => onOpenResults(group)}
                >
                  <Sparkles className="w-3 h-3 ml-1" />
                  {group.stage === "completed" ? "تعديل نتائج الفقس" : "إدخال نتائج الفقس"}
                </Button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>



        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">ملخص الدفعة</h4>
            <Row label="تاريخ الدخول" value={group.entry_date} />
            <Row label="الماكينة" value={group.machine} />
            <Row label="الكشف الأول" value={group.candle1_display || `~${group.expCandle1 || "—"}`} />
            <Row label="الكشف الثاني" value={group.candle2_display || `~${group.expCandle2 || "—"}`} />
            <Row
              label="الخروج/الهاتشر"
              value={
                group.exited
                  ? `${group.exit_display} (خرجت ✓)`
                  : `لم تخرج — متوقع ~${group.expectedExit || "—"}`
              }
            />
            <Row label="عدد دفعات العملاء" value={group.customers.length} />
            <Row label="أرقام الدفعات" value={Array.from(group.batch_numbers).join(", ")} />
          </Card>
          <Card className="p-3 space-y-1">
            <h4 className="font-semibold mb-2 text-primary">الإجماليات</h4>
            <Row label="بيض نعام العاصمة (داخلي)" value={fmtNum(group.internal_eggs)} />
            <Row label="بيض العملاء الخارجيين" value={fmtNum(group.external_eggs)} />
            <Row label="إجمالي البيض" value={fmtNum(group.total_eggs)} />
            <Row label="إجمالي الصافي" value={fmtNum(group.net_eggs)} />
            <Row label="كتاكيت العاصمة" value={fmtNum(group.internal_chicks)} />
            <Row label="كتاكيت العملاء الخارجيين" value={fmtNum(group.external_chicks)} />
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
                <TableHead>تعديل</TableHead>
                {accountsEnabled && <TableHead>حساب العميل</TableHead>}
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
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditRow({ raw: { id: c.id, ...raw, batch_number: c.batch_number, customer_name: c.customer_name }, name: c.customer_name })}
                      >
                        <Pencil className="w-3 h-3 ml-1" /> تعديل
                      </Button>
                    </TableCell>
                    {accountsEnabled && (
                      <TableCell>
                        {c.type === "internal" || !c._raw?.customer_id ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                            disabled={openingAccount === c.id}
                            onClick={() => openCustomerAccount(c)}
                          >
                            <Wallet className="w-3 h-3 ml-1" />
                            {openingAccount === c.id ? "..." : "حساب العميل"}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>

        {editRow && (
          <HatchBatchRowEditDialog
            row={editRow.raw}
            customerName={editRow.name}
            onClose={() => setEditRow(null)}
            onSaved={() => { setEditRow(null); onRefresh?.(); }}
          />
        )}

        {addEggsOpen && (
          <BatchAddEggsDialog
            group={group}
            onClose={() => setAddEggsOpen(false)}
            onSaved={() => { setAddEggsOpen(false); onRefresh?.(); }}
          />
        )}

        {accountLotId && (
          <BatchAccountDialog
            lotId={accountLotId}
            customerName={accountName}
            onClose={() => { setAccountLotId(null); onRefresh?.(); }}
          />
        )}

        {!accountsEnabled && opNo > 0 && opNo < 18 && (
          <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-xs p-2 text-amber-800 dark:text-amber-200">
            دفعة قديمة (رقم {opNo}) — حسابات العملاء وإصدار الفواتير متاحة من دفعة 18 وما بعدها فقط.
          </div>
        )}

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
      <tr><td><b>حالة الخروج:</b> ${g.exited ? `خرجت بتاريخ ${escapeHtml(g.exit_display)}` : `لم تخرج — متوقع ~${escapeHtml(g.expectedExit || "—")}`}</td>
          <td><b>عدد العملاء:</b> ${g.customers.length}</td></tr>
      <tr><td><b>بيض نعام العاصمة:</b> ${fmtNum(g.internal_eggs)}</td>
          <td><b>بيض العملاء الخارجيين:</b> ${fmtNum(g.external_eggs)}</td></tr>
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
