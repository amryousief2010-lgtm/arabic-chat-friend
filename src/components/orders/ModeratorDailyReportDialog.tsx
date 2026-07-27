import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageDown, FileDown } from "lucide-react";
import { toCairoDateString } from "@/lib/cairoDate";
import { toast } from "sonner";

interface OrderLite {
  id: string;
  order_number: string;
  total: number;
  created_at: string;
  created_by?: string | null;
  delivery_address?: string | null;
  customers?: { name?: string | null; phone?: string | null } | null;
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
  const reportRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    return orders
      .filter((o) => o.created_by === userId && toCairoDateString(o.created_at) === date)
      .map((o) => ({
        order_number: o.order_number,
        customer_name: o.customers?.name || "-",
        customer_phone: o.customers?.phone || "-",
        delivery_address: o.delivery_address || "-",
        total: Number(o.total || 0),
      }));
  }, [orders, userId, date]);

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
      "العنوان": r.delivery_address,
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
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تقرير طلباتي اليومي</DialogTitle>
        </DialogHeader>

        <div className="flex items-end gap-3 flex-wrap mb-4">
          <div>
            <Label className="text-xs">اختاري اليوم</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
          </div>
          <Button onClick={downloadImage} className="gap-2 bg-primary text-white">
            <ImageDown className="w-4 h-4" /> تنزيل صورة
          </Button>
          <Button variant="outline" onClick={downloadExcel} className="gap-2">
            <FileDown className="w-4 h-4" /> تنزيل Excel
          </Button>
        </div>

        {/* Report preview (this is what gets rendered as image) */}
        <div
          ref={reportRef}
          dir="rtl"
          style={{
            background: "#ffffff",
            color: "#111",
            padding: "20px",
            fontFamily: "Cairo, Tajawal, system-ui, sans-serif",
            borderRadius: 8,
          }}
        >
          {/* Header block — kept as before */}
          <div
            style={{
              background: "linear-gradient(90deg, hsl(270 60% 45%), hsl(20 90% 55%))",
              color: "#fff",
              padding: "16px 20px",
              borderRadius: 8,
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800 }}>تقرير طلبات {moderatorName}</div>
            <div style={{ fontSize: 13, opacity: 0.95, marginTop: 4 }}>{dateLabel}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, background: "#faf7ff" }}>
              <div style={{ fontSize: 12, color: "#666" }}>عدد الطلبات</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "hsl(270 60% 45%)" }}>{rows.length}</div>
            </div>
            <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, background: "#fff5ec" }}>
              <div style={{ fontSize: 12, color: "#666" }}>إجمالي القيمة</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "hsl(20 90% 45%)" }}>
                {totalSum.toLocaleString()} ج.م
              </div>
            </div>
          </div>

          {/* Simplified table */}
          {rows.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "#888" }}>لا توجد طلبات في هذا اليوم</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f3f0fa" }}>
                  <th style={thStyle}>رقم الطلب</th>
                  <th style={thStyle}>العميل</th>
                  <th style={thStyle}>الهاتف</th>
                  <th style={thStyle}>الإجمالي</th>
                  <th style={thStyle}>العنوان</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.order_number} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                    <td style={tdStyle}>{r.order_number}</td>
                    <td style={tdStyle}>{r.customer_name}</td>
                    <td style={{ ...tdStyle, direction: "ltr", textAlign: "right" as const }}>{r.customer_phone}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{r.total.toLocaleString()} ج.م</td>
                    <td style={tdStyle}>{r.delivery_address}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const thStyle: React.CSSProperties = {
  border: "1px solid #e5e5e5",
  padding: "8px 6px",
  textAlign: "right",
  fontWeight: 700,
  fontSize: 12,
};
const tdStyle: React.CSSProperties = {
  border: "1px solid #eee",
  padding: "8px 6px",
  textAlign: "right",
};

export default ModeratorDailyReportDialog;
