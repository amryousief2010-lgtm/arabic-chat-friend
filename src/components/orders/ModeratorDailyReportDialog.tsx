import { useEffect, useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageDown, FileDown } from "lucide-react";
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
}

const ModeratorDailyReportDialog = ({ open, onOpenChange, orders, userId, moderatorName }: Props) => {
  const [date, setDate] = useState<string>(() => toCairoDateString(new Date()));
  const [fetched, setFetched] = useState<OrderLite[] | null>(null);
  const [loading, setLoading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  // Fetch the selected day's orders straight from the database so changing the
  // date isn't limited to whatever the Orders page currently has loaded.
  useEffect(() => {
    if (!open || !userId || !date) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const [y, m, d] = date.split("-").map(Number);
        const from = cairoWallClockToUTC(y, m - 1, d, 0, 0, 0).toISOString();
        const to = cairoWallClockToUTC(y, m - 1, d + 1, 0, 0, 0).toISOString();
        const { data, error } = await supabase
          .from("orders")
          .select("id, order_number, total, created_at, created_by, customer_name, customer_phone, customer_phone2, customers(name, phone, phone2)")
          .eq("created_by", userId)
          .gte("created_at", from)
          .lt("created_at", to)
          .order("created_at", { ascending: true });
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
  }, [open, userId, date]);

  const rows = useMemo(() => {
    const source = fetched ?? orders;
    return source
      .filter((o) => o.created_by === userId && toCairoDateString(o.created_at) === date)
      .map((o) => ({
        order_number: o.order_number,
        customer_name: o.customer_name || o.customers?.name || "-",
        customer_phone: o.customer_phone || o.customers?.phone || o.customer_phone2 || o.customers?.phone2 || "-",
        total: Number(o.total || 0),
      }));
  }, [fetched, orders, userId, date]);

  const totalSum = rows.reduce((s, r) => s + r.total, 0);
  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("ar-EG-u-nu-latn", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });


  const downloadImage = async () => {
    if (!reportRef.current) return;
    if (!rows.length) return toast.error("لا توجد طلبات في هذا اليوم");
    try {
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
        a.download = `طلبات-${moderatorName}-${date}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
      toast.success("تم تنزيل الصورة");
    } catch (e: any) {
      toast.error(e.message || "تعذّر إنشاء الصورة");
    }
  };

  const downloadExcel = () => {
    if (!rows.length) return toast.error("لا توجد طلبات في هذا اليوم");
    const data = rows.map((r) => ({
      "رقم الطلب": r.order_number,
      "العميل": r.customer_name,
      "الهاتف": r.customer_phone,
      "الإجمالي": r.total,
    }));
    const wb = XLSX.utils.book_new();
    const headerRows: any[][] = [
      ["المسوقة:", moderatorName],
      ["التاريخ:", dateLabel],
      ["عدد الطلبات:", rows.length],
      ["إجمالي القيمة:", totalSum],
      [],
    ];
    const ws = XLSX.utils.aoa_to_sheet(headerRows);
    XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
    XLSX.utils.book_append_sheet(wb, ws, "الطلبات");
    XLSX.writeFile(wb, `طلبات-${moderatorName}-${date}.xlsx`, { bookType: "xlsx" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تقرير طلباتي اليومي</DialogTitle>
        </DialogHeader>

        <div className="flex items-end gap-3 flex-wrap mb-4">
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
                    onSelect={(d) => d && setDate(toCairoDateString(d))}
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
              <div style={{ fontSize: 14, fontWeight: 800 }}>تقرير طلبات {moderatorName}</div>
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
                    <th style={{ ...thStyle, width: "32%" }}>رقم الطلب</th>
                    <th style={{ ...thStyle, width: "24%" }}>العميل</th>
                    <th style={{ ...thStyle, width: "24%" }}>الهاتف</th>
                    <th style={{ ...thStyle, width: "20%" }}>الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.order_number} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                      <td style={{ ...tdStyle, wordBreak: "break-all" }}>{r.order_number}</td>
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
