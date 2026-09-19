import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ImageDown, FileDown, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { toCairoDateString, cairoWallClockToUTC } from "@/lib/cairoDate";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderLite {
  id: string;
  order_number: string;
  total: number;
  created_at: string;
  created_by?: string | null;
  delivery_address?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_phone2?: string | null;
  customers?: { name?: string | null; phone?: string | null; phone2?: string | null } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orders: OrderLite[];
  userId: string;
  moderatorName: string;
  /** Managers see every moderator's orders, with a selector to focus on one. */
  canViewAll?: boolean;
}

const ModeratorDailyReportDialog = ({ open, onOpenChange, orders, userId, moderatorName, canViewAll = false }: Props) => {
  const [date, setDate] = useState<string>(() => toCairoDateString(new Date()));
  const [fetched, setFetched] = useState<OrderLite[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [moderators, setModerators] = useState<{ id: string; name: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>(canViewAll ? "all" : userId);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedUserId(canViewAll ? "all" : userId);
  }, [canViewAll, userId]);

  // Managers: load the list of moderators so every girl's orders are visible.
  useEffect(() => {
    if (!open || !canViewAll) return;
    let cancelled = false;
    (async () => {
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "sales_moderator");
      const ids = Array.from(new Set((roleRows || []).map((r: any) => r.user_id))).filter(Boolean);
      if (ids.length === 0) { if (!cancelled) setModerators([]); return; }
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      if (!cancelled) {
        setModerators(
          (profs || []).map((p: any) => ({ id: p.id, name: p.full_name || "مسوقة" }))
            .sort((a, b) => a.name.localeCompare(b.name, "ar"))
        );
      }
    })();
    return () => { cancelled = true; };
  }, [open, canViewAll]);

  const moderatorIds = useMemo(() => moderators.map((m) => m.id), [moderators]);
  const nameByUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of moderators) map[m.id] = m.name;
    return map;
  }, [moderators]);

  const viewingAll = canViewAll && selectedUserId === "all";

  // Fetch the selected day's orders straight from the database so changing the
  // date isn't limited to whatever the Orders page currently has loaded.
  useEffect(() => {
    if (!open || !date) return;
    if (viewingAll && moderatorIds.length === 0) return;
    if (!viewingAll && !selectedUserId) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const [y, m, d] = date.split("-").map(Number);
        const from = cairoWallClockToUTC(y, m - 1, d, 0, 0, 0).toISOString();
        const to = cairoWallClockToUTC(y, m - 1, d + 1, 0, 0, 0).toISOString();
        let query = supabase
          .from("orders")
          .select("id, order_number, total, created_at, created_by, customers(name, phone, phone2)")
          .gte("created_at", from)
          .lt("created_at", to);
        query = viewingAll ? query.in("created_by", moderatorIds) : query.eq("created_by", selectedUserId);
        const { data, error } = await query.order("created_at", { ascending: true });
        if (error) throw error;
        if (!cancelled) setFetched((data || []) as any);
      } catch (e: any) {
        if (!cancelled) {
          setFetched(null);
          toast.error(e.message || "تعذّر تحميل طلبات هذا اليوم");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [open, selectedUserId, viewingAll, moderatorIds, date]);

  const rows = useMemo(() => {
    // Database results are already restricted to the Cairo-day range.
    // Only filter by date when falling back to the Orders page's local data.
    const source = fetched ?? orders.filter(
      (o) => (viewingAll ? true : o.created_by === selectedUserId) && toCairoDateString(o.created_at) === date,
    );
    return source
      .map((o) => ({
        order_number: o.order_number,
        moderator: nameByUserId[o.created_by || ""] || moderatorName,
        customer_name: o.customer_name || o.customers?.name || "-",
        customer_phone: o.customer_phone || o.customers?.phone || o.customer_phone2 || o.customers?.phone2 || "-",
        total: Number(o.total || 0),
      }));
  }, [fetched, orders, selectedUserId, viewingAll, nameByUserId, moderatorName, date]);

  const perModerator = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const r of rows) {
      const cur = map.get(r.moderator) || { count: 0, total: 0 };
      map.set(r.moderator, { count: cur.count + 1, total: cur.total + r.total });
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total);
  }, [rows]);

  const reportTitleName = viewingAll
    ? "كل المسوقات"
    : (nameByUserId[selectedUserId] || moderatorName);


  const totalSum = rows.reduce((s, r) => s + r.total, 0);
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ar-EG-u-nu-latn", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // Display as DD-MM-YYYY (اليوم-الشهر-السنة)
  const displayDate = (() => {
    const [y, m, d] = date.split("-");
    return `${d}-${m}-${y}`;
  })();
  const selectedDateObj = (() => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d);
  })();
  const shiftDay = (delta: number) => {
    const next = new Date(selectedDateObj);
    next.setDate(next.getDate() + delta);
    const p = (n: number) => String(n).padStart(2, "0");
    setDate(`${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`);
  };


  const downloadImage = async () => {
    if (!reportRef.current) return;
    if (!rows.length) return toast.error("لا توجد طلبات في هذا اليوم");
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(reportRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `طلبات-${reportTitleName}-${date}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
      toast.success("تم تنزيل الصورة");
    } catch (e: any) {
      toast.error(e.message || "تعذّر إنشاء الصورة");
    }
  };

  const downloadExcel = async () => {
    if (!rows.length) return toast.error("لا توجد طلبات في هذا اليوم");
    const XLSX = await import("xlsx");
    const data = rows.map((r) => ({
      "رقم الطلب": r.order_number,
      ...(viewingAll ? { "المسوقة": r.moderator } : {}),
      "العميل": r.customer_name,
      "الهاتف": r.customer_phone,
      "الإجمالي": r.total,
    }));
    const wb = XLSX.utils.book_new();
    const headerRows: any[][] = [
      ["المسوقة:", reportTitleName],
      ["التاريخ:", dateLabel],
      ["عدد الطلبات:", rows.length],
      ["إجمالي القيمة:", totalSum],
      [],
    ];
    if (viewingAll && perModerator.length > 0) {
      headerRows.splice(4, 0, ["تفصيل حسب المسوقة:"], ...perModerator.map(([n, v]) => [n, v.count, v.total]));
    }
    const ws = XLSX.utils.aoa_to_sheet(headerRows);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
    XLSX.writeFile(wb, `طلبات-${reportTitleName}-${date}.xlsx`, { bookType: "xlsx" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{canViewAll ? "ملخص طلبات المسوقات اليومي" : "تقرير طلباتي اليومي"}</DialogTitle>
        </DialogHeader>

        <div className="flex items-end gap-3 flex-wrap mb-4">
          {canViewAll && (
            <div>
              <Label className="text-xs">المسوقة</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل المسوقات</SelectItem>
                  {moderators.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>

            <Label className="text-xs">اختاري اليوم</Label>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDay(-1)} aria-label="اليوم السابق">
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-40 justify-between font-mono text-sm">
                    {displayDate}
                    <CalendarIcon className="w-4 h-4 opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDateObj}
                    onSelect={(d) => {
                      if (!d) return;
                      const p = (n: number) => String(n).padStart(2, "0");
                      setDate(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
                    }}
                    initialFocus
                    className="pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
              <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => shiftDay(1)} aria-label="اليوم التالي">
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <Button onClick={downloadImage} className="gap-2 bg-primary text-white">
            <ImageDown className="w-4 h-4" /> تنزيل صورة
          </Button>
          <Button variant="outline" onClick={downloadExcel} className="gap-2">
            <FileDown className="w-4 h-4" /> تنزيل Excel
          </Button>
        </div>

        {/* Square mobile-friendly report — fits phone screen without scrolling */}
        <div className="overflow-x-auto">
          <div
            ref={reportRef}
            dir="rtl"
            style={{
              width: 360,
              minHeight: 360,
              background: "#ffffff",
              color: "#111",
              padding: 12,
              fontFamily: "Cairo, Tajawal, system-ui, sans-serif",
              borderRadius: 8,
              margin: "0 auto",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                background: "linear-gradient(90deg, hsl(270 60% 45%), hsl(20 90% 55%))",
                color: "#fff",
                padding: "10px 12px",
                borderRadius: 8,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 800 }}>تقرير طلبات {reportTitleName}</div>
              <div style={{ fontSize: 10, opacity: 0.95, marginTop: 2 }}>{dateLabel}</div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
              <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 6, background: "#faf7ff" }}>
                <div style={{ fontSize: 9, color: "#666" }}>عدد الطلبات</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "hsl(270 60% 45%)" }}>{rows.length}</div>
              </div>
              <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 6, background: "#fff5ec" }}>
                <div style={{ fontSize: 9, color: "#666" }}>إجمالي القيمة</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "hsl(20 90% 45%)" }}>
                  {totalSum.toLocaleString()} ج.م
                </div>
              </div>
            </div>

            {viewingAll && perModerator.length > 0 && (
              <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 6, marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "#666", marginBottom: 4 }}>تفصيل حسب المسوقة</div>
                {perModerator.map(([name, v]) => (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "2px 0" }}>
                    <span style={{ fontWeight: 700 }}>{name}</span>
                    <span>{v.count} طلب — {v.total.toLocaleString()} ج.م</span>
                  </div>
                ))}
              </div>
            )}

            {loading ? (
              <div style={{ textAlign: "center", padding: 24, color: "#888", fontSize: 12 }}>
                جاري تحميل طلبات هذا اليوم…
              </div>
            ) : rows.length === 0 ? (
              <div style={{ textAlign: "center", padding: 24, color: "#888", fontSize: 12 }}>
                لا توجد طلبات في هذا اليوم
              </div>

            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, tableLayout: "fixed" }}>
                <thead>
                  <tr style={{ background: "#f3f0fa" }}>
                    <th style={{ ...thStyle, width: viewingAll ? "26%" : "32%" }}>رقم الطلب</th>
                    {viewingAll && <th style={{ ...thStyle, width: "16%" }}>المسوقة</th>}
                    <th style={{ ...thStyle, width: viewingAll ? "20%" : "24%" }}>العميل</th>
                    <th style={{ ...thStyle, width: viewingAll ? "20%" : "24%" }}>الهاتف</th>
                    <th style={{ ...thStyle, width: "18%" }}>الإجمالي</th>
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.order_number} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                      <td style={{ ...tdStyle, wordBreak: "break-all" }}>{r.order_number}</td>
                      {viewingAll && <td style={{ ...tdStyle, wordBreak: "break-word" }}>{r.moderator}</td>}
                      <td style={{ ...tdStyle, wordBreak: "break-word" }}>{r.customer_name}</td>
                      <td style={{ ...tdStyle, direction: "ltr", textAlign: "right" as const, wordBreak: "break-all" }}>{r.customer_phone}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{r.total.toLocaleString()} ج.م</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const thStyle: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  padding: "4px 3px",
  textAlign: "right",
  fontWeight: 700,
  fontSize: 9,
};
const tdStyle: React.CSSProperties = {
  border: "1px solid #eee",
  padding: "4px 3px",
  textAlign: "right",
};

export default ModeratorDailyReportDialog;
