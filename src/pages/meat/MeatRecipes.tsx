import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChefHat, Printer, FileText, Factory } from "lucide-react";
import recipesData from "@/data/meatRecipes.json";

type Line = { code: number; name: string; kind: "raw"|"spice"|"packaging"; unit: string; qty: number; per_kg: number; price: number; total: number; warehouse: string };
type Recipe = { key: string; product: string; code: number; batch_qty: number; unit: string; wages: number; lines: Line[] };

const recipes = recipesData as Recipe[];
const KIND_LABEL: Record<string,string> = { raw: "خامة", spice: "بهارات", packaging: "تغليف" };
const KIND_COLOR: Record<string,string> = { raw: "bg-blue-600", spice: "bg-amber-600", packaging: "bg-emerald-600" };
const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 3 });
const esc = (s: any) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function totals(r: Recipe) {
  const raw = r.lines.filter(l => l.kind === "raw").reduce((s,l) => s + l.total, 0);
  const spice = r.lines.filter(l => l.kind === "spice").reduce((s,l) => s + l.total, 0);
  const pack = r.lines.filter(l => l.kind === "packaging").reduce((s,l) => s + l.total, 0);
  const tot = raw + spice + pack + Number(r.wages || 0);
  const unit_cost = r.batch_qty > 0 ? tot / r.batch_qty : 0;
  return { raw, spice, pack, tot, unit_cost };
}

function printRecipe(r: Recipe, requestedQty?: number) {
  const factor = requestedQty && requestedQty > 0 ? requestedQty / r.batch_qty : 1;
  const t = totals(r);
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تركيبة ${esc(r.product)}</title>
<style>
  body{font-family:'Cairo','Tajawal',Arial;padding:20px;color:#111}
  h1{margin:0 0 6px;color:#7c3aed}
  table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px}
  th,td{border:1px solid #999;padding:6px;text-align:right}
  th{background:#f3e8ff}
  .summary{margin-top:12px;padding:10px;background:#fafafa;border:1px solid #ccc}
  .sig{margin-top:30px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px}
  .sig div{border-top:1px dashed #555;padding-top:6px;text-align:center}
  @media print {.no-print{display:none}}
</style></head><body>
<h1>تركيبة تصنيع: ${esc(r.product)} <small style="color:#666">(كود ${r.code})</small></h1>
<div>كمية التشغيلة القياسية: <b>${fmt(r.batch_qty)} ${esc(r.unit)}</b>${requestedQty?` — الكمية المطلوبة: <b>${fmt(requestedQty)} ${esc(r.unit)}</b> (معامل ×${fmt(factor)})`:''}</div>
<table><thead><tr><th>م</th><th>الكود</th><th>الخامة</th><th>النوع</th><th>الوحدة</th><th>كمية التشغيلة</th>${requestedQty?'<th>كمية مطلوبة</th>':''}<th>سعر الوحدة</th><th>الإجمالي</th><th>المخزن</th></tr></thead><tbody>
${r.lines.map((l,i)=>`<tr><td>${i+1}</td><td>${l.code}</td><td>${esc(l.name)}</td><td><span style="color:#fff;background:${l.kind==='raw'?'#2563eb':l.kind==='spice'?'#d97706':'#059669'};padding:2px 6px;border-radius:3px;font-size:11px">${KIND_LABEL[l.kind]}</span></td><td>${esc(l.unit)}</td><td>${fmt(l.qty)}</td>${requestedQty?`<td><b>${fmt(l.qty*factor)}</b></td>`:''}<td>${fmt(l.price)}</td><td>${fmt(l.total*factor)}</td><td>${esc(l.warehouse)}</td></tr>`).join('')}
</tbody></table>
<div class="summary">
<div>إجمالي الخامات: <b>${fmt(t.raw*factor)}</b> ج</div>
<div>إجمالي البهارات: <b>${fmt(t.spice*factor)}</b> ج</div>
<div>إجمالي التغليف: <b>${fmt(t.pack*factor)}</b> ج</div>
<div>أجور: <b>${fmt(r.wages*factor)}</b> ج</div>
<div>إجمالي التكلفة: <b style="color:#7c3aed;font-size:16px">${fmt(t.tot*factor)} ج</b></div>
<div>تكلفة الكيلو/الوحدة: <b>${fmt(t.unit_cost)} ج/${esc(r.unit)}</b></div>
</div>
<h3 style="margin-top:20px">ملاحظات التشغيل:</h3>
<div style="border:1px solid #ccc;min-height:60px;padding:8px"></div>
<div class="sig"><div>توقيع مسؤول المصنع</div><div>توقيع العامل</div><div>توقيع المدير المعتمد</div></div>
<div class="no-print" style="margin-top:20px;text-align:center"><button onclick="window.print()" style="padding:8px 20px;background:#7c3aed;color:#fff;border:none;border-radius:4px;cursor:pointer">طباعة</button></div>
</body></html>`;
  const w = window.open("", "_blank");
  if (w) { w.document.write(html); w.document.close(); setTimeout(()=>w.print(), 400); }
}

export default function MeatRecipes() {
  const nav = useNavigate();
  const [selected, setSelected] = useState<string>(recipes[0]?.key || "");
  const [search, setSearch] = useState("");
  const [requestedQty, setRequestedQty] = useState<Record<string,number>>({});

  const filtered = useMemo(() => recipes.filter(r => !search || r.product.includes(search) || r.key.includes(search)), [search]);
  const current = recipes.find(r => r.key === selected) || recipes[0];
  const t = current ? totals(current) : null;

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <ChefHat className="w-7 h-7 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold">تركيبات التصنيع — مرجع مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">{recipes.length} تركيبة جاهزة، تشمل الخامات والبهارات والتغليف بأسعارها وتكلفة الكيلو.</p>
          </div>
        </div>

        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">ملخص التركيبات</TabsTrigger>
            <TabsTrigger value="detail">تفاصيل التركيبة</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-3">
            <Input placeholder="بحث باسم المنتج…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
            <Card><CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المنتج</TableHead><TableHead>الكود</TableHead><TableHead>التشغيلة</TableHead>
                  <TableHead>خامات</TableHead><TableHead>بهارات</TableHead><TableHead>تغليف</TableHead>
                  <TableHead>أجور</TableHead><TableHead>الإجمالي</TableHead><TableHead>تكلفة الوحدة</TableHead>
                  <TableHead>عدد البنود</TableHead><TableHead>إجراءات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const x = totals(r);
                    return (
                      <TableRow key={r.key} className="cursor-pointer hover:bg-muted/40" onClick={() => { setSelected(r.key); }}>
                        <TableCell className="font-medium">{r.product}</TableCell>
                        <TableCell className="font-mono text-xs">{r.code}</TableCell>
                        <TableCell>{fmt(r.batch_qty)} {r.unit}</TableCell>
                        <TableCell>{fmt(x.raw)}</TableCell>
                        <TableCell>{fmt(x.spice)}</TableCell>
                        <TableCell>{fmt(x.pack)}</TableCell>
                        <TableCell>{fmt(r.wages)}</TableCell>
                        <TableCell className="font-bold text-purple-700">{fmt(x.tot)}</TableCell>
                        <TableCell className="font-bold">{fmt(x.unit_cost)}</TableCell>
                        <TableCell>{r.lines.length}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => { setSelected(r.key); document.querySelector<HTMLButtonElement>('[data-state="inactive"][value="detail"]')?.click(); }}>عرض</Button>
                            <Button size="sm" variant="outline" onClick={() => printRecipe(r)}><Printer className="w-3 h-3" /></Button>
                            <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => nav(`/meat-factory/manufacturing?recipe=${encodeURIComponent(r.key)}`)}>
                              <Factory className="w-3 h-3 ml-1" />استخدم
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="detail" className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {recipes.map(r => (
                <Button key={r.key} variant={selected===r.key?"default":"outline"} size="sm" onClick={() => setSelected(r.key)} className={selected===r.key?"bg-purple-600 hover:bg-purple-700":""}>{r.product}</Button>
              ))}
            </div>
            {current && t && (
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle>{current.product} <span className="text-sm text-muted-foreground font-mono">#{current.code}</span></CardTitle>
                      <CardDescription>تشغيلة قياسية: {fmt(current.batch_qty)} {current.unit}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input type="number" placeholder="كمية مطلوبة" className="w-32" value={requestedQty[current.key] || ""} onChange={e => setRequestedQty(s => ({ ...s, [current.key]: Number(e.target.value) }))} />
                      <Button variant="outline" onClick={() => printRecipe(current, requestedQty[current.key])}>
                        <Printer className="w-4 h-4 ml-1" /> طباعة أمر تشغيل
                      </Button>
                      <Button className="bg-purple-600 hover:bg-purple-700" onClick={() => nav(`/meat-factory/manufacturing?recipe=${encodeURIComponent(current.key)}${requestedQty[current.key]?`&qty=${requestedQty[current.key]}`:''}`)}>
                        <FileText className="w-4 h-4 ml-1" /> استخدم في فاتورة تصنيع
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>م</TableHead><TableHead>الكود</TableHead><TableHead>الخامة</TableHead><TableHead>النوع</TableHead>
                      <TableHead>الوحدة</TableHead><TableHead>كمية التشغيلة</TableHead><TableHead>لكل 1 كجم</TableHead>
                      <TableHead>سعر الوحدة</TableHead><TableHead>الإجمالي</TableHead><TableHead>المخزن</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {current.lines.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell>{i+1}</TableCell>
                          <TableCell className="font-mono text-xs">{l.code}</TableCell>
                          <TableCell className="font-medium">{l.name}</TableCell>
                          <TableCell><Badge className={KIND_COLOR[l.kind]}>{KIND_LABEL[l.kind]}</Badge></TableCell>
                          <TableCell>{l.unit}</TableCell>
                          <TableCell>{fmt(l.qty)}</TableCell>
                          <TableCell className="text-muted-foreground text-xs">{fmt(l.per_kg)}</TableCell>
                          <TableCell>{fmt(l.price)}</TableCell>
                          <TableCell className="font-medium">{fmt(l.total)}</TableCell>
                          <TableCell className="text-xs">{l.warehouse}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <Card className="mt-3 border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
                    <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-6 gap-3 text-sm">
                      <div><div className="text-muted-foreground">خامات</div><div className="font-bold">{fmt(t.raw)}</div></div>
                      <div><div className="text-muted-foreground">بهارات</div><div className="font-bold">{fmt(t.spice)}</div></div>
                      <div><div className="text-muted-foreground">تغليف</div><div className="font-bold">{fmt(t.pack)}</div></div>
                      <div><div className="text-muted-foreground">أجور</div><div className="font-bold">{fmt(current.wages)}</div></div>
                      <div><div className="text-muted-foreground">الإجمالي</div><div className="font-bold text-purple-700">{fmt(t.tot)} ج</div></div>
                      <div><div className="text-muted-foreground">تكلفة الوحدة</div><div className="font-bold text-purple-700">{fmt(t.unit_cost)} ج/{current.unit}</div></div>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
