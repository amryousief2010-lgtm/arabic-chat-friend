import { useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Printer, Plus, Trash2 } from "lucide-react";
import logo from "@/assets/slaughter-permit-logo.jpg";

type Row = { decision: string; signature: string; count: string };

const todayStr = () => new Date().toISOString().slice(0, 10);

const SlaughterPermit = () => {
  const [form, setForm] = useState({
    requesterName: "",
    phone: "",
    address: "",
    licenseNo: "",
    date: todayStr(),
    managerSignature: "",
  });
  const [rows, setRows] = useState<Row[]>([
    { count: "", decision: "", signature: "" },
    { count: "", decision: "", signature: "" },
    { count: "", decision: "", signature: "" },
  ]);

  const upd = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const updRow = (i: number, k: keyof Row, v: string) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((rs) => [...rs, { count: "", decision: "", signature: "" }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const handlePrint = () => window.print();

  const fmtDate = (d: string) => {
    if (!d) return "      /      /      ";
    const [y, m, day] = d.split("-");
    return `${day} / ${m} / ${y}`;
  };

  return (
    <DashboardLayout>
      <div className="print:hidden">
        <Header title="إذن ذبح النعام" subtitle="إنشاء نموذج طلب ذبح النعام والكشف على لحومها وطباعته" />

        <div className="grid lg:grid-cols-2 gap-4 mb-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="font-bold text-foreground mb-2">بيانات طالب الخدمة</h3>
              <div>
                <Label>اسم طالب الخدمة</Label>
                <Input value={form.requesterName} onChange={(e) => upd("requesterName", e.target.value)} maxLength={100} />
              </div>
              <div>
                <Label>رقم الهاتف</Label>
                <Input value={form.phone} onChange={(e) => upd("phone", e.target.value)} maxLength={20} />
              </div>
              <div>
                <Label>محل الإقامة</Label>
                <Input value={form.address} onChange={(e) => upd("address", e.target.value)} maxLength={200} />
              </div>
              <div>
                <Label>رقم رخصة مزاولة المهنة</Label>
                <Input value={form.licenseNo} onChange={(e) => upd("licenseNo", e.target.value)} maxLength={50} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>تاريخ طلب الذبح</Label>
                  <Input type="date" value={form.date} onChange={(e) => upd("date", e.target.value)} />
                </div>
                <div>
                  <Label>توقيع مدير المجزر</Label>
                  <Input value={form.managerSignature} onChange={(e) => upd("managerSignature", e.target.value)} maxLength={100} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-foreground">بيانات الذبح</h3>
                <Button size="sm" variant="outline" onClick={addRow}>
                  <Plus className="w-4 h-4 ml-1" /> إضافة سطر
                </Button>
              </div>
              {rows.map((r, i) => (
                <div key={i} className="border rounded p-3 space-y-2 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">نعام #{i + 1}</span>
                    {rows.length > 1 && (
                      <Button size="icon" variant="ghost" onClick={() => delRow(i)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <Label className="text-xs">العدد</Label>
                      <Input value={r.count} onChange={(e) => updRow(i, "count", e.target.value)} maxLength={20} />
                    </div>
                    <div>
                      <Label className="text-xs">قرار الطبيب البيطري</Label>
                      <Textarea
                        value={r.decision}
                        onChange={(e) => updRow(i, "decision", e.target.value)}
                        rows={2}
                        maxLength={500}
                      />
                    </div>
                    <div>
                      <Label className="text-xs">توقيع الطبيب</Label>
                      <Input value={r.signature} onChange={(e) => updRow(i, "signature", e.target.value)} maxLength={100} />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-end mb-6">
          <Button onClick={handlePrint} size="lg">
            <Printer className="w-4 h-4 ml-2" />
            طباعة الإذن
          </Button>
        </div>
      </div>

      {/* Printable area */}
      <div className="permit-print bg-white text-black mx-auto" dir="rtl">
        <div className="border-2 border-black p-6">
          <div className="flex items-start gap-4 border-b-2 border-black pb-3 mb-3">
            <img src={logo} alt="شعار شركة نعام العاصمة" className="w-24 h-24 object-contain" />
            <div className="flex-1 text-center">
              <h1 className="text-2xl font-extrabold">شركة نعام العاصمة</h1>
              <p className="text-sm mt-1">العنوان: محافظة الغربية - مركز زفتى - قرية مسجد وصيف</p>
              <p className="font-bold text-lg mt-1">مجــــــزر نعــــــام</p>
              <p className="text-xs mt-1">
                ت: 01063619794 — ت: 01096944578 — ت: 01028181775 — ت: 01014011050
              </p>
              <p className="text-xs mt-1">قرار وزاري رقم (298) لسنة 2023 برقم كودي (N/1604020114)</p>
              <p className="text-xs mt-1 font-semibold">تم الذبح طبقًا للشريعة الإسلامية وتحت إشراف بيطري كامل</p>
            </div>
          </div>

          <h2 className="text-center text-xl font-bold my-4 underline">
            نموذج طلب ذبح نعام والكشف على لحومها بالمجزر
          </h2>

          <div className="space-y-2 text-base leading-loose mb-4">
            <p>
              <span className="font-semibold">اسم طالب الخدمة:</span>{" "}
              <span className="border-b border-dotted border-black inline-block min-w-[300px]">
                {form.requesterName || "\u00A0"}
              </span>
            </p>
            <p>
              <span className="font-semibold">رقم الهاتف:</span>{" "}
              <span className="border-b border-dotted border-black inline-block min-w-[300px]">
                {form.phone || "\u00A0"}
              </span>
            </p>
            <p>
              <span className="font-semibold">محل الإقامة:</span>{" "}
              <span className="border-b border-dotted border-black inline-block min-w-[300px]">
                {form.address || "\u00A0"}
              </span>
            </p>
            <p>
              <span className="font-semibold">رقم رخصة مزاولة المهنة:</span>{" "}
              <span className="border-b border-dotted border-black inline-block min-w-[260px]">
                {form.licenseNo || "\u00A0"}
              </span>
            </p>
          </div>

          <table className="w-full border-collapse border border-black text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-black p-2 w-[12%]">نوع الذبيحة</th>
                <th className="border border-black p-2 w-[10%]">العدد</th>
                <th className="border border-black p-2">
                  قرار الطبيب البيطري
                  <div className="text-xs font-normal">
                    (بمراجعة بيانات ذبح النعامة والكشف على اللحوم تبين ما يلي)
                  </div>
                </th>
                <th className="border border-black p-2 w-[18%]">توقيع الطبيب</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="border border-black p-2 text-center font-semibold">نعام</td>
                  <td className="border border-black p-2 text-center">{r.count || "\u00A0"}</td>
                  <td className="border border-black p-2 whitespace-pre-wrap min-h-[40px]">{r.decision || "\u00A0"}</td>
                  <td className="border border-black p-2 text-center">{r.signature || "\u00A0"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between items-end mt-8 text-base">
            <p>
              <span className="font-semibold">تاريخ طلب الذبح:</span>{" "}
              <span className="border-b border-dotted border-black inline-block min-w-[140px] text-center">
                {fmtDate(form.date)}
              </span>
            </p>
            <p>
              <span className="font-semibold">توقيع مدير المجزر:</span>{" "}
              <span className="border-b border-dotted border-black inline-block min-w-[220px]">
                {form.managerSignature || "\u00A0"}
              </span>
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @media screen {
          .permit-print { max-width: 800px; margin-top: 1rem; box-shadow: 0 4px 16px rgba(0,0,0,.08); border-radius: .5rem; padding: 1rem; }
        }
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .permit-print { width: 100%; }
        }
      `}</style>
    </DashboardLayout>
  );
};

export default SlaughterPermit;
