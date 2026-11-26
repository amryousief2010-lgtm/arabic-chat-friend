import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import ZodexSyncStatusPanel from "@/components/warehouses/zodex/ZodexSyncStatusPanel";
import { TIER_LABEL_AR, type MatchTier } from "@/lib/zodexMatchEngine";

// Brand palette (logo) + golden ratio layout.
const C = { magenta: "#A4288A", orange: "#F37346", purple: "#662D8C" };
const PHI = 1.618;

type QTier = MatchTier | "SUSPECT";
interface Candidate { order_id: string; order_number: string; score: number; evidence?: { text: string; ok: boolean }[] }
interface QueueRow {
  id: string; bill_no: string; tier: QTier; score: number | null; amount_diff: number | null; zodex_cod: number | null;
  zodex_status: string | null; shipment_date: string | null; reasons: string[]; candidates: Candidate[];
  suggested_order_id: string | null; state: string; linked_order_id: string | null; decided_at: string | null; created_at: string;
}

const TIERS: { key: QTier; label: string; color: string; help: string }[] = [
  { key: "REVIEW", label: TIER_LABEL_AR.REVIEW, color: C.orange, help: "اختاري الأوردر الصحيح أو ارفضي" },
  { key: "BLOCKED", label: TIER_LABEL_AR.BLOCKED, color: C.magenta, help: "تعارض لا يُحل تلقائيًا" },
  { key: "SUSPECT", label: "ربط قديم مشكوك فيه", color: C.purple, help: "روابط سابقة تحتاج تأكيد" },
  { key: "NO_ORDER", label: TIER_LABEL_AR.NO_ORDER, color: "#6B7280", help: "لا يوجد أوردر بنفس الموبايل" },
  { key: "AUTO", label: TIER_LABEL_AR.AUTO, color: "#2E7D32", help: "مطابقة كاملة — للاطلاع أو التأكيد الجماعي" },
];

const fmt = (n: number | null) => (n == null ? "—" : n.toLocaleString("ar-EG"));
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("ar-EG", { timeZone: "Africa/Cairo" }) : "—");

export default function ZodexAutoLinkReview() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [tier, setTier] = useState<QTier>("REVIEW");
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [orderNo, setOrderNo] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    let query = (supabase as any).from("zodex_link_queue").select("*").order("created_at", { ascending: false }).limit(2000);
    query = showDone ? query.neq("state", "superseded") : query.in("state", ["open", "auto_linked"]);
    const { data, error } = await query;
    if (error) { toast.error("تعذّر تحميل قائمة المراجعة"); return; }
    setRows((data ?? []) as QueueRow[]);
    const ids = Array.from(new Set((data ?? []).flatMap((r: QueueRow) => [r.suggested_order_id, r.linked_order_id]).filter(Boolean)));
    if (ids.length) {
      const { data: os } = await supabase.from("orders").select("id, order_number").in("id", ids as string[]);
      setOrderNo(Object.fromEntries((os ?? []).map((o: any) => [o.id, o.order_number])));
    }
  }, [showDone]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (supabase as any).rpc("zodex_can_review").then(({ data }: any) => setCanDecide(Boolean(data)));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) if (r.state === "open" || r.state === "auto_linked") c[r.tier] = (c[r.tier] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(() => {
    const s = q.trim();
    return rows.filter((r) => r.tier === tier)
      .filter((r) => !onlyDiff || (r.amount_diff ?? 0) !== 0)
      .filter((r) => !s || r.bill_no.includes(s) ||
        (r.candidates ?? []).some((c) => c.order_number?.includes(s)) ||
        (r.linked_order_id && orderNo[r.linked_order_id]?.includes(s)));
  }, [rows, tier, q, onlyDiff, orderNo]);

  const decide = async (r: QueueRow, action: "confirm" | "reject") => {
    setBusy(r.id);
    const { error } = await (supabase as any).rpc("zodex_review_decide", {
      p_queue_id: r.id, p_action: action, p_order_id: picked[r.id] ?? null, p_note: null,
    });
    setBusy(null);
    if (error) return toast.error(errorAr(error.message));
    toast.success(action === "confirm" ? "تم تأكيد الربط" : "تم الرفض");
    load();
  };
  const undo = async (r: QueueRow) => {
    setBusy(r.id);
    const { error } = await (supabase as any).rpc("zodex_link_undo", { p_queue_id: r.id, p_note: null });
    setBusy(null);
    if (error) return toast.error(errorAr(error.message));
    toast.success("تم التراجع وأُعيدت البوليصة للمراجعة");
    load();
  };
  const bulk = async () => {
    const ids = visible.filter((r) => r.state === "open" && selected.has(r.id)).map((r) => r.id);
    if (!ids.length) return;
    setBusy("bulk");
    const { data, error } = await (supabase as any).rpc("zodex_review_bulk_confirm", { p_queue_ids: ids });
    setBusy(null);
    if (error) return toast.error(errorAr(error.message));
    toast.success(`تم تأكيد ${data?.confirmed ?? 0} — تعذّر ${data?.failed ?? 0}`);
    setSelected(new Set()); load();
  };
  const exportCsv = () => {
    const head = ["رقم البوليصة", "رقم الأوردر المقترح/المربوط", "التصنيف", "الدرجة", "مبلغ زودكس", "فرق المبلغ", "تاريخ الشحن", "الأسباب", "الحالة"];
    const lines = visible.map((r) => [
      r.bill_no, orderNo[r.linked_order_id ?? r.suggested_order_id ?? ""] ?? "", TIERS.find((t) => t.key === r.tier)?.label,
      r.score ?? "", r.zodex_cod ?? "", r.amount_diff ?? "", day(r.shipment_date), (r.reasons ?? []).join(" | "), r.state,
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    const blob = new Blob(["\ufeff" + [head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `مراجعة-البوالص-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: C.purple }}>مراجعة ربط البوالص بالأوردرات</h1>
          <p className="text-sm text-muted-foreground">الربط يتم تلقائيًا. دورك المراجعة فقط: تأكيد أو رفض أو اختيار أوردر آخر. لا يُعدَّل إجمالي الأوردر أبدًا.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>تصدير Excel</Button>
          <Button variant="outline" onClick={load}>تحديث</Button>
        </div>
      </header>

      <ZodexSyncStatusPanel />

      <nav className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        {TIERS.map((t) => (
          <button key={t.key} onClick={() => { setTier(t.key); setSelected(new Set()); }}
            className="rounded-xl p-3 text-start border-2 transition"
            style={{ borderColor: tier === t.key ? t.color : "transparent", background: `${t.color}14`, aspectRatio: `${PHI}` }}>
            <div className="text-3xl font-bold" style={{ color: t.color }}>{fmt(counts[t.key] ?? 0)}</div>
            <div className="font-semibold">{t.label}</div>
            <div className="text-xs text-muted-foreground">{t.help}</div>
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap gap-3 items-center">
        <Input className="max-w-xs" placeholder="ابحث برقم الأوردر أو رقم البوليصة" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> فرق في المبلغ فقط</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> عرض ما تمت مراجعته</label>
        {tier === "AUTO" && canDecide && (
          <Button disabled={!selected.size || busy === "bulk"} onClick={bulk} style={{ background: C.magenta }}>
            تأكيد المحدد ({fmt(selected.size)})
          </Button>
        )}
        <span className="text-sm text-muted-foreground ms-auto">المعروض: {fmt(visible.length)}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead style={{ background: `${C.purple}10` }}>
            <tr className="text-start">
              {tier === "AUTO" && <th className="p-2"><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(visible.filter((r) => r.state === "open").map((r) => r.id)) : new Set())} /></th>}
              <th className="p-2 text-start">رقم الأوردر</th>
              <th className="p-2 text-start">رقم البوليصة</th>
              <th className="p-2 text-start">مبلغ زودكس / الفرق</th>
              <th className="p-2 text-start">تاريخ الشحن</th>
              <th className="p-2 text-start" style={{ width: `${(100 / (1 + PHI)) * PHI * 0.5}%` }}>سبب التصنيف</th>
              <th className="p-2 text-start">الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const current = r.linked_order_id ?? r.suggested_order_id;
              return (
                <tr key={r.id} className="border-t align-top">
                  {tier === "AUTO" && <td className="p-2"><input type="checkbox" disabled={r.state !== "open"} checked={selected.has(r.id)} onChange={(e) => { const s = new Set(selected); e.target.checked ? s.add(r.id) : s.delete(r.id); setSelected(s); }} /></td>}
                  <td className="p-2 font-mono">
                    {r.candidates?.length > 1 && r.state === "open" ? (
                      <select className="border rounded p-1" value={picked[r.id] ?? r.suggested_order_id ?? ""} onChange={(e) => setPicked({ ...picked, [r.id]: e.target.value })}>
                        {r.candidates.map((c) => <option key={c.order_id} value={c.order_id}>{c.order_number} — {c.score}%</option>)}
                      </select>
                    ) : (orderNo[current ?? ""] ?? r.candidates?.[0]?.order_number ?? "—")}
                  </td>
                  <td className="p-2 font-mono">{r.bill_no}</td>
                  <td className="p-2">{fmt(r.zodex_cod)}{r.amount_diff ? <span className="ms-2 font-bold" style={{ color: C.orange }}>({r.amount_diff > 0 ? "+" : ""}{fmt(r.amount_diff)})</span> : null}</td>
                  <td className="p-2">{day(r.shipment_date)}</td>
                  <td className="p-2"><ul className="list-disc ps-4 space-y-0.5">{(r.reasons ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></td>
                  <td className="p-2 whitespace-nowrap space-x-1 space-x-reverse">
                    {!canDecide ? <span className="text-muted-foreground">عرض فقط</span>
                      : r.state === "open" && r.tier !== "NO_ORDER" ? (<>
                        <Button size="sm" disabled={busy === r.id || r.tier === "BLOCKED" && !picked[r.id]} onClick={() => decide(r, "confirm")} style={{ background: C.magenta }}>تأكيد</Button>
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => decide(r, "reject")}>رفض</Button>
                      </>) : (r.state === "auto_linked" || r.state === "confirmed") ? (
                        <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => undo(r)} style={{ borderColor: C.orange, color: C.orange }}>تراجع</Button>
                      ) : <span className="text-muted-foreground">{stateAr(r.state)}</span>}
                  </td>
                </tr>
              );
            })}
            {!visible.length && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">لا توجد بوالص في هذا التصنيف.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function stateAr(s: string) {
  return ({ confirmed: "تم التأكيد", rejected: "مرفوض", undone: "تم التراجع", auto_linked: "مربوط تلقائيًا", open: "مفتوح" } as Record<string, string>)[s] ?? s;
}
function errorAr(m: string) {
  if (m.includes("NOT_AUTHORIZED")) return "ليست لديك صلاحية اتخاذ هذا القرار";
  if (m.includes("BILL_ON_OTHER_ORDER")) return "البوليصة مربوطة بأوردر آخر — راجعي التعارض أولًا";
  if (m.includes("ORDER_HAS_OTHER_BILL")) return "الأوردر مربوط ببوليصة أخرى";
  if (m.includes("ORDER_NOT_A_CANDIDATE")) return "الأوردر المختار ليس ضمن المرشحين";
  if (m.includes("NOT_SAFE_TIER")) return "التأكيد الجماعي متاح للمطابقة الكاملة فقط";
  return "تعذّر تنفيذ العملية";
}
