import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Factory, Plus, Trash2, CheckCircle2, Send, Loader2, Printer, Eye, ChefHat, AlertTriangle, Link2, Ban } from "lucide-react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import recipesData from "@/data/meatRecipes.json";
import { parseServiceCostsFromNotes, userNotesFromInvoice, type ServiceCostRow } from "@/lib/meatServiceCosts";

type MeatRecipe = { key: string; product: string; code: number; batch_qty: number; unit: string; wages: number; lines: { code: number; name: string; kind: "raw"|"spice"|"packaging"; unit: string; qty: number; price: number; total: number }[] };
const MEAT_RECIPES = recipesData as MeatRecipe[];

type Kind = "raw" | "spice" | "packaging";
type Warehouse = { id: string; name: string; type: string };
type RawItem = { id: string; name: string; unit: string; current_stock: number; avg_cost: number; kind: Kind; is_active: boolean; code?: string | null };
type Line = { tmp: string; item_id: string; item_name: string; kind: Kind; unit: string; quantity: number; unit_cost: number; line_total: number; notes: string | null };
type ServiceCostLine = { tmp: string; item_name: string; unit: string; quantity: number; unit_cost: number; line_total: number; notes: string | null };
type Invoice = {
  id: string; invoice_no: string | null; product_name: string; finished_qty: number; unit: string;
  status: string; raw_cost: number; spice_cost: number; packaging_cost: number; extra_cost: number;
  materials_total_cost: number; total_manufacturing_cost: number; unit_cost: number | null;
  factory_warehouse_id: string; finished_item_id: string | null; destination_kind: string;
  transfer_id: string | null; transfer_no: string | null; created_at: string; approved_at: string | null; approved_by: string | null;
  notes: string | null; legacy_transferred?: boolean;
};

const KIND_LABEL: Record<Kind,string> = { raw: "خامة", spice: "بهارات", packaging: "تغليف" };
const PRODUCT_PRESETS = ["برجر نعام", "كفتة نعام", "سجق نعام", "مفروم نعام", "حواوشي", "نقانق", "شاورما", "شيش"];
const newLine = (k: Kind = "raw"): Line => ({ tmp: crypto.randomUUID(), item_id: "", item_name: "", kind: k, unit: "كجم", quantity: 0, unit_cost: 0, line_total: 0, notes: null });
const esc = (s: any) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const fmt = (n: any) => Number(n || 0).toLocaleString("ar-EG", { maximumFractionDigits: 2 });
const serviceNotesFromInvoice = (notes?: string | null) => String(notes || "").split("\n").filter(l => l.startsWith("[service_cost]"));

export default function ManufacturingInvoices() {
  const { user, roles } = useAuth();
  const isApprover = roles?.some(r => r === "general_manager" || r === "executive_manager" || r === "meat_factory_manager" || r === "production_manager");
  const [tab, setTab] = useState("new");
  const [factoryWarehouses, setFactoryWarehouses] = useState<Warehouse[]>([]);
  const [mainWarehouses, setMainWarehouses] = useState<Warehouse[]>([]);
  const [factoryWarehouseId, setFactoryWarehouseId] = useState<string>("");
  const [items, setItems] = useState<RawItem[]>([]);
  const [productName, setProductName] = useState("");
  const [productNameOther, setProductNameOther] = useState("");
  const [finishedQty, setFinishedQty] = useState<number>(0);
  const [unit, setUnit] = useState("كجم");
  const [destinationKind, setDestinationKind] = useState<"factory_warehouse"|"main_warehouse_direct">("factory_warehouse");
  const [notes, setNotes] = useState("");
  const [extraCost, setExtraCost] = useState<number>(0);
  const [rawLines, setRawLines] = useState<Line[]>([newLine("raw")]);
  const [packLines, setPackLines] = useState<Line[]>([newLine("packaging")]);
  const [serviceCostLines, setServiceCostLines] = useState<ServiceCostLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [invoiceUuid, setInvoiceUuid] = useState<string>(() => crypto.randomUUID());

  // Carryover dough — OUT (this invoice produces leftover dough)
  const [hasCarryoverOut, setHasCarryoverOut] = useState(false);
  const [carryoverOutQty, setCarryoverOutQty] = useState<number>(0);
  const [carryoverOutProduct, setCarryoverOutProduct] = useState<string>("");
  const [carryoverOutNotes, setCarryoverOutNotes] = useState<string>("");

  // Carryover dough — IN (this invoice consumes available leftover dough)
  type CarryRow = { id: string; source_invoice_no: string | null; source_product_name: string; remaining_qty_kg: number; unit_cost: number; production_date: string; status: string };
  const [availableCarryovers, setAvailableCarryovers] = useState<CarryRow[]>([]);
  const [carryoverInId, setCarryoverInId] = useState<string>("");
  const [carryoverInQty, setCarryoverInQty] = useState<number>(0);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [transferStatusMap, setTransferStatusMap] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [viewLines, setViewLines] = useState<any[]>([]);
  const [transferInv, setTransferInv] = useState<Invoice | null>(null);
  const [transferDestId, setTransferDestId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Duplicate-detection
  type SimilarInv = { id: string; invoice_no: string | null; product_name: string; finished_qty: number; unit: string; status: string; created_at: string; created_by: string | null; created_by_name?: string | null };
  const [similarFound, setSimilarFound] = useState<SimilarInv | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const canOverrideDuplicate = roles?.some(r => r === "general_manager" || r === "executive_manager");

  // Cancel/void
  type CancelImpact = { lines: any[]; finishedStock: number | null; finishedItemName?: string | null };
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelForce, setCancelForce] = useState(false);
  const [cancelImpact, setCancelImpact] = useState<CancelImpact | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const canForceCancel = roles?.some(r => r === "general_manager" || r === "executive_manager");


  type Mapping = { id?: string; recipe_item_name: string; recipe_item_kind: Kind; mapped_raw_item_id: string; mapped_raw_item_name: string };
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const mapKey = (name: string, kind: Kind) => `${(name || "").trim().toLowerCase()}|${kind}`;
  const mappingsIndex = useMemo(() => {
    const m = new Map<string, Mapping>();
    mappings.forEach(x => m.set(mapKey(x.recipe_item_name, x.recipe_item_kind), x));
    return m;
  }, [mappings]);

  const fetchAll = async () => {
    const [whs, inv, ri, mp, cd] = await Promise.all([
      supabase.from("warehouses").select("id, name, type").order("name"),
      supabase.from("meat_manufacturing_invoices" as any).select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("meat_factory_raw_items" as any).select("id,name,unit,current_stock,avg_cost,kind,is_active,code").eq("is_active", true).order("name"),
      supabase.from("meat_recipe_item_mappings" as any).select("id,recipe_item_name,recipe_item_kind,mapped_raw_item_id,mapped_raw_item_name"),
      supabase.from("meat_factory_carryover_dough" as any)
        .select("id,source_invoice_no,source_product_name,remaining_qty_kg,unit_cost,production_date,status")
        .in("status", ["available", "partial"])
        .gt("remaining_qty_kg", 0)
        .order("created_at", { ascending: false }),
    ]);
    if (whs.data) {
      const factory = whs.data.filter(w => w.name?.includes("مصنع اللحوم"));
      const main = whs.data.filter(w => w.type === "finished_goods" && !w.name?.includes("مصنع"));
      setFactoryWarehouses(factory);
      setMainWarehouses(main);
      if (factory[0]) setFactoryWarehouseId(prev => prev || factory[0].id);
    }
    if (inv.data) {
      setInvoices(inv.data as any);
      const tids = Array.from(new Set((inv.data as any[]).map((i: any) => i.transfer_id).filter(Boolean)));
      if (tids.length) {
        const { data: trs } = await supabase.from("warehouse_transfers").select("id,status").in("id", tids);
        const map: Record<string, string> = {};
        (trs || []).forEach((t: any) => { map[t.id] = t.status; });
        setTransferStatusMap(map);
      } else setTransferStatusMap({});
    }
    if (ri.data) setItems(ri.data as any);
    if (mp.data) setMappings(mp.data as any);
    if (cd.data) setAvailableCarryovers(cd.data as any);
  };

  useEffect(() => { fetchAll(); }, []);

  const rawCandidates = useMemo(() => items.filter(i => i.kind === "raw" || i.kind === "spice"), [items]);
  const packCandidates = useMemo(() => items.filter(i => i.kind === "packaging"), [items]);
  // Search box for the packaging picker
  const [packSearch, setPackSearch] = useState("");
  const packCandidatesFiltered = useMemo(() => {
    const q = packSearch.trim().toLowerCase();
    return packCandidates.filter(c => {
      const hasStock = Number(c.current_stock || 0) > 0;
      if (!hasStock) return false;
      if (!q) return true;
      return (c.name || "").toLowerCase().includes(q);
    });
  }, [packCandidates, packSearch]);

  const updateLine = (setter: (fn: (ls: Line[]) => Line[]) => void, candidates: RawItem[], tmp: string, patch: Partial<Line>) => {
    setter(ls => ls.map(l => {
      if (l.tmp !== tmp) return l;
      const m = { ...l, ...patch };
      if (patch.item_id) {
        const it = candidates.find(x => x.id === patch.item_id);
        if (it) { m.item_name = it.name; m.unit = it.unit; m.kind = it.kind; if (!m.unit_cost) m.unit_cost = Number(it.avg_cost || 0); }
      }
      m.line_total = Number((Number(m.quantity || 0) * Number(m.unit_cost || 0)).toFixed(3));
      return m;
    }));
  };

  const rawCost = useMemo(() => rawLines.filter(l => l.kind === "raw").reduce((s,l) => s + Number(l.line_total||0), 0), [rawLines]);
  const spiceCost = useMemo(() => rawLines.filter(l => l.kind === "spice").reduce((s,l) => s + Number(l.line_total||0), 0), [rawLines]);
  const packCost = useMemo(() => packLines.reduce((s,l) => s + Number(l.line_total||0), 0), [packLines]);
  const serviceCost = useMemo(() => serviceCostLines.reduce((s,l) => s + Number(l.line_total||0), 0), [serviceCostLines]);

  // Carryover-IN selected balance & its monetary cost
  const selectedCarryover = useMemo(
    () => availableCarryovers.find(c => c.id === carryoverInId) || null,
    [availableCarryovers, carryoverInId]
  );
  const carryoverInCost = useMemo(() => {
    if (!selectedCarryover || !carryoverInQty) return 0;
    return Number(carryoverInQty) * Number(selectedCarryover.unit_cost || 0);
  }, [selectedCarryover, carryoverInQty]);
  const carryoverInError = useMemo(() => {
    if (!selectedCarryover) return null;
    const q = Number(carryoverInQty || 0);
    if (q <= 0) return null;
    if (q > Number(selectedCarryover.remaining_qty_kg || 0)) return "الكمية المستخدمة أكبر من المتاح من العجينة المرحلة";
    return null;
  }, [selectedCarryover, carryoverInQty]);

  const totalExtraCost = Number(extraCost || 0) + serviceCost + carryoverInCost;
  const totalCost = rawCost + spiceCost + packCost + totalExtraCost;
  // Unit cost is distributed over (finished + leftover dough): both share the same raw/packaging/extra batch.
  const totalManufacturedQty = Number(finishedQty || 0) + Number(carryoverOutQty || 0);
  const unitCost = totalManufacturedQty > 0 ? totalCost / totalManufacturedQty : 0;
  const carryoverOutUnitCost = unitCost;
  const finishedProductCost = Number(finishedQty || 0) * unitCost;
  const carryoverOutValue = Number(carryoverOutQty || 0) * unitCost;

  const finalProductName = productName === "أخرى" ? productNameOther.trim() : productName;

  const resetForm = () => {
    setRawLines([newLine("raw")]); setPackLines([newLine("packaging")]);
    setServiceCostLines([]);
    setProductName(""); setProductNameOther(""); setFinishedQty(0); setNotes("");
    setExtraCost(0); setDestinationKind("factory_warehouse");
    setHasCarryoverOut(false); setCarryoverOutQty(0); setCarryoverOutProduct(""); setCarryoverOutNotes("");
    setCarryoverInId(""); setCarryoverInQty(0);
    setInvoiceUuid(crypto.randomUUID());
  };

  const normalizeAr = (s: string) => (s || "")
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, "")
    .replace(/[×x]/g, "*")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/سودا/g, "سوده")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
  const arTokens = (s: string) => normalizeAr(s).split(" ").filter(Boolean);

  const isServiceCostItem = (name: string, code?: number) => Number(code) === 15009 || normalizeAr(name).includes("ماده خدميه");

  // Hardcoded aliases for known recipe-vs-inventory name mismatches.
  // Match priority: saved mapping → code → hard alias → exact normalized name → token-subset.
  const HARD_ALIASES: Array<{ recipe: string; kind: Kind; target: string; code?: number }> = [
    { recipe: "فرم نعام", kind: "raw", target: "لحم نعام فرم", code: 12019 },
    { recipe: "علب كفته", kind: "packaging", target: "علب كفته" },
    { recipe: "علب كفتة", kind: "packaging", target: "علب كفته" },
    { recipe: "دهن نعام", kind: "raw", target: "دهن نعام", code: 12014 },
    { recipe: "لحم برازيلي", kind: "raw", target: "لحم بقري (برازيلي)", code: 17001 },
    { recipe: "لحم بقري", kind: "raw", target: "لحم بقري (برازيلي)", code: 17001 },
    { recipe: "ازازه زيت", kind: "raw", target: "لازو زيت" },
    { recipe: "ازازة زيت", kind: "raw", target: "لازو زيت" },
    { recipe: "لازو زيت", kind: "raw", target: "لازو زيت" },
    { recipe: "عصير جهينه", kind: "raw", target: "عصر جبنة" },
    { recipe: "عصير جهينة", kind: "raw", target: "عصر جبنة" },
    { recipe: "عصر جبنة", kind: "raw", target: "عصر جبنة" },
    { recipe: "صلصه", kind: "spice", target: "صلصة" },
    { recipe: "صلصة", kind: "spice", target: "صلصة" },
    { recipe: "اكياس سودا مقاس 20*30", kind: "packaging", target: "أكياس سودة مقاس 30×20" },
    { recipe: "أكياس سودة مقاس 30*20", kind: "packaging", target: "أكياس سودة مقاس 30×20" },
    { recipe: "اكياس سودة مقاس 30*20", kind: "packaging", target: "أكياس سودة مقاس 30×20" },
    { recipe: "أكياس سودة مقاس 30×20", kind: "packaging", target: "أكياس سودة مقاس 30×20" },
  ];

  const resolveItem = (name: string, kind: Kind, code?: number): RawItem | undefined => {
    // 0) saved mapping wins
    const map = mappingsIndex.get(mapKey(name, kind));
    if (map) {
      const it = items.find(i => i.id === map.mapped_raw_item_id);
      if (it) return it;
    }
    const pool = items.filter(it => kind === "raw" ? (it.kind === "raw" || it.kind === "spice") : it.kind === kind);
    // 1) match by code if present
    if (code) {
      const byCode = pool.find(it => Number((it as any).code) === Number(code));
      if (byCode) return byCode;
    }
    const target = normalizeAr(name);
    if (!target) return undefined;
    // 2) hardcoded alias
    const alias = HARD_ALIASES.find(a => normalizeAr(a.recipe) === target && (a.kind === kind || (kind === "raw" && a.kind === "raw")));
    if (alias) {
      if (alias.code) {
        const byCode = pool.find(it => Number((it as any).code) === alias.code);
        if (byCode) return byCode;
      }
      const aliasTarget = normalizeAr(alias.target);
      const byName = pool.find(it => normalizeAr(it.name) === aliasTarget);
      if (byName) return byName;
    }
    // 3) exact normalized name
    const exact = pool.find(it => normalizeAr(it.name) === target);
    if (exact) return exact;
    // 4) subset-token match: every recipe token appears in candidate name (normalized)
    const recTokens = arTokens(name);
    if (recTokens.length === 0) return undefined;
    let best: { it: RawItem; score: number } | undefined;
    for (const it of pool) {
      const candNorm = normalizeAr(it.name);
      const candTokens = arTokens(it.name);
      if (!recTokens.every(t => candNorm.includes(t))) continue;
      const score = recTokens.length / Math.max(candTokens.length, 1);
      if (!best || score > best.score) best = { it, score };
    }
    return best?.it;
  };

  const [selectedRecipeKey, setSelectedRecipeKey] = useState<string>("");
  const loadRecipe = (key: string, qtyOverride?: number) => {
    const r = MEAT_RECIPES.find(x => x.key === key);
    if (!r) return;
    setSelectedRecipeKey(key);
    const requested = qtyOverride && qtyOverride > 0 ? qtyOverride : r.batch_qty;
    const factor = requested / r.batch_qty;
    if (PRODUCT_PRESETS.includes(r.product)) { setProductName(r.product); setProductNameOther(""); }
    else { setProductName("أخرى"); setProductNameOther(r.product); }
    setFinishedQty(requested);
    setUnit(r.unit || "كجم");
    // Extra/service cost is now a single MANUAL numeric field — do not auto-populate
    // from recipe wages or auto-create service-cost line items.
    setExtraCost(0);
    setServiceCostLines([]);
    const buildLine = (l: { code: number; name: string; kind: Kind; unit: string; qty: number; price: number }): Line => {
      const match = resolveItem(l.name, l.kind, l.code);
      return {
        tmp: crypto.randomUUID(),
        item_id: match?.id || "",
        item_name: match?.name || l.name,
        kind: match?.kind || l.kind,
        unit: match?.unit || l.unit,
        quantity: Number((l.qty * factor).toFixed(3)),
        unit_cost: match ? Number(match.avg_cost || l.price) : Number(l.price.toFixed(3)),
        line_total: Number((l.qty * factor * (match ? Number(match.avg_cost || l.price) : l.price)).toFixed(3)),
        notes: match ? (match.name !== l.name ? `اسم التركيبة: ${l.name}` : null) : "⚠ غير مربوط بمخزون مصنع اللحوم — اختر بديل من جدول المطابقة",
      };
    };

    const stockLines = r.lines.filter(l => !isServiceCostItem(l.name, l.code));
    const rawSpice = stockLines.filter(l => l.kind !== "packaging").map(buildLine);
    const pack = stockLines.filter(l => l.kind === "packaging").map(buildLine);
    setRawLines(rawSpice.length ? rawSpice : [newLine("raw")]);
    setPackLines(pack.length ? pack : [newLine("packaging")]);
    const missing = [...rawSpice, ...pack].filter(l => !l.item_id).length;
    if (missing > 0) toast.warning(`هذه الأصناف غير مرتبطة بمخزون مصنع اللحوم. اختر البديل الصحيح أو أنشئ الصنف في المخزون. لا يتم الاعتماد قبل اكتمال الربط.`);
    else toast.success(`تم تحميل تركيبة ${r.product} (×${factor.toFixed(2)})`);
  };

  const [searchParams] = useSearchParams();
  useEffect(() => {
    const k = searchParams.get("recipe");
    const q = Number(searchParams.get("qty") || 0);
    if (k && items.length > 0 && k !== selectedRecipeKey) {
      loadRecipe(k, q || undefined);
      setTab("new");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, items.length]);

  const unmappedLines = useMemo(
    () => [...rawLines, ...packLines].filter(l => (l.item_name?.trim() || "") && !l.item_id),
    [rawLines, packLines]
  );
  const insufficientLines = useMemo(() => {
    const all = [...rawLines, ...packLines];
    return all.filter(l => {
      if (!l.item_id || !l.quantity) return false;
      const it = items.find(x => x.id === l.item_id);
      return it && Number(l.quantity) > Number(it.current_stock || 0);
    });
  }, [rawLines, packLines, items]);

  const saveMapping = async (recipeName: string, kind: Kind, rawItemId: string) => {
    const it = items.find(i => i.id === rawItemId);
    if (!it) { toast.error("اختر صنفًا من المخزون"); return; }
    const existing = mappingsIndex.get(mapKey(recipeName, kind));
    const payload = {
      recipe_item_name: recipeName.trim(),
      recipe_item_kind: kind,
      mapped_raw_item_id: rawItemId,
      mapped_raw_item_name: it.name,
      created_by: user?.id || null,
    } as any;
    const { error } = existing?.id
      ? await supabase.from("meat_recipe_item_mappings" as any).update(payload).eq("id", existing.id)
      : await supabase.from("meat_recipe_item_mappings" as any).insert(payload);
    if (error) { toast.error(error.message || "فشل حفظ الربط"); return; }
    setMappings(prev => {
      const others = prev.filter(m => mapKey(m.recipe_item_name, m.recipe_item_kind) !== mapKey(recipeName, kind));
      return [...others, { id: existing?.id, recipe_item_name: recipeName.trim(), recipe_item_kind: kind, mapped_raw_item_id: rawItemId, mapped_raw_item_name: it.name }];
    });
    // rebind matching lines in current invoice
    const rebind = (l: Line): Line => {
      if (l.item_id || l.item_name?.trim() !== recipeName.trim() || l.kind !== kind) return l;
      const cost = Number(it.avg_cost || l.unit_cost || 0);
      return { ...l, item_id: rawItemId, item_name: it.name, kind: it.kind, unit: it.unit, unit_cost: cost || l.unit_cost, line_total: Number((Number(l.quantity || 0) * (cost || l.unit_cost || 0)).toFixed(3)), notes: it.name !== recipeName ? `اسم التركيبة: ${recipeName}` : null };
    };
    setRawLines(ls => ls.map(rebind));
    setPackLines(ls => ls.map(rebind));
    toast.success(`تم ربط "${recipeName}" بـ "${it.name}" — سيتم تطبيقه تلقائيًا في التركيبات القادمة`);
  };

  const findSimilarInvoice = async (): Promise<SimilarInv | null> => {
    // Look back 24 hours for an invoice with the same product + finished_qty, not cancelled
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.from("meat_manufacturing_invoices" as any)
      .select("id, invoice_no, product_name, finished_qty, unit, status, created_at, created_by")
      .eq("product_name", finalProductName)
      .eq("finished_qty", finishedQty)
      .eq("factory_warehouse_id", factoryWarehouseId)
      .neq("status", "cancelled")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const row: any = data;
    let creatorName: string | null = null;
    if (row.created_by) {
      const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", row.created_by).maybeSingle();
      creatorName = (prof as any)?.full_name || (prof as any)?.email || null;
    }
    return { ...row, created_by_name: creatorName };
  };

  const submitDraft = async (override?: { reason: string; similarId: string }) => {
    if (!factoryWarehouseId) { toast.error("اختر مخزن مصنع اللحوم"); return; }
    if (!finalProductName) { toast.error("اختر/أدخل اسم المنتج النهائي"); return; }
    if (!finishedQty || finishedQty <= 0) { toast.error("أدخل كمية المنتج التام"); return; }
    if (unmappedLines.length > 0) {
      toast.error("لا يمكن حفظ الفاتورة قبل مطابقة كل أصناف التركيبة مع مخزون مصنع اللحوم.");
      return;
    }
    if (insufficientLines.length > 0) {
      const first = insufficientLines[0];
      const it = items.find(x => x.id === first.item_id);
      toast.error(`الرصيد غير كافٍ للصنف: ${first.item_name}. المطلوب: ${first.quantity}، المتاح: ${it?.current_stock ?? 0}.`);
      return;
    }
    const validRaw = rawLines.filter(l => l.item_id && l.quantity > 0);
    const validPack = packLines.filter(l => l.item_id && l.quantity > 0);
    const allLines = [...validRaw, ...validPack];
    if (validRaw.length === 0 || validPack.length === 0) {
      toast.error("لا يمكن حفظ فاتورة تصنيع بدون بنود خامات وتغليف");
      return;
    }

    // Carryover-OUT validation
    if (hasCarryoverOut) {
      if (!carryoverOutQty || Number(carryoverOutQty) <= 0) {
        toast.error("أدخل كمية العجينة المتبقية بالكيلو");
        return;
      }
    }
    // Carryover-IN validation
    if (carryoverInId) {
      if (carryoverInError) { toast.error(carryoverInError); return; }
      if (!carryoverInQty || Number(carryoverInQty) <= 0) {
        toast.error("أدخل كمية العجينة المرحلة المستخدمة");
        return;
      }
    }

    // Duplicate-invoice guard (skip if user already confirmed override)
    if (!override) {
      const similar = await findSimilarInvoice();
      if (similar) {
        setSimilarFound(similar);
        setOverrideReason("");
        return; // wait for user decision via dialog
      }
    }

    setSaving(true);
    try {
      const existing = await supabase.from("meat_manufacturing_invoices" as any)
        .select("id, invoice_no").eq("manufacturing_invoice_uuid", invoiceUuid).maybeSingle();
      if (existing.data) { toast.info("الفاتورة محفوظة بالفعل"); await fetchAll(); resetForm(); setTab("list"); return; }



      const { data: noRes, error: noErr } = await supabase.rpc("gen_meat_invoice_no" as any);
      if (noErr) throw noErr;
      const invoiceNo = noRes as unknown as string;

      const carryoverInNote = carryoverInId && selectedCarryover
        ? `[carryover_in] استخدام ${fmt(carryoverInQty)} كجم عجينة مرحلة من ${selectedCarryover.source_product_name} (فاتورة ${selectedCarryover.source_invoice_no || "—"}) × ${fmt(selectedCarryover.unit_cost)} = ${fmt(carryoverInCost)}`
        : "";
      const carryoverOutNote = hasCarryoverOut
        ? `[carryover_out] تم حفظ ${fmt(carryoverOutQty)} كجم عجينة متبقية برصيد العجينة المرحلة بتكلفة ${fmt(carryoverOutUnitCost)} ج/كجم${carryoverOutNotes ? " — " + carryoverOutNotes : ""}`
        : "";

      const { data: inv, error: insErr } = await supabase.from("meat_manufacturing_invoices" as any).insert({
        invoice_no: invoiceNo,
        product_name: finalProductName,
        finished_qty: finishedQty,
        unit,
        factory_warehouse_id: factoryWarehouseId,
        destination_kind: destinationKind,
        manufacturing_invoice_uuid: invoiceUuid,
        materials_total_cost: rawCost + spiceCost + packCost,
        raw_cost: rawCost, spice_cost: spiceCost, packaging_cost: packCost,
        extra_cost: totalExtraCost, total_manufacturing_cost: totalCost,
        unit_cost: unitCost,
        status: "draft",
        notes: [
          notes,
          ...serviceCostLines.map(l => `[service_cost] ${l.item_name}: ${fmt(l.quantity)} ${l.unit} × ${fmt(l.unit_cost)} = ${fmt(l.line_total)}`),
          carryoverInNote,
          carryoverOutNote,
        ].filter(Boolean).join("\n") || null,
        created_by: user?.id || null,
      } as any).select("id").single();
      if (insErr) throw insErr;

      const { error: linesErr } = await supabase.from("meat_manufacturing_invoice_lines" as any).insert(
        allLines.map(l => ({
          invoice_id: (inv as any).id,
          item_id: l.item_id, item_name: l.item_name, kind: l.kind,
          unit: l.unit, quantity: l.quantity, unit_cost: l.unit_cost, line_total: l.line_total,
          notes: l.notes,
        })) as any
      );
      if (linesErr) {
        await supabase.from("meat_manufacturing_invoices" as any).delete().eq("id", (inv as any).id);
        throw new Error("فشل حفظ بنود الفاتورة، لم يتم إنشاء الفاتورة");
      }

      // Carryover-OUT: insert leftover dough balance
      if (hasCarryoverOut && Number(carryoverOutQty) > 0) {
        const { error: coErr } = await supabase.from("meat_factory_carryover_dough" as any).insert({
          source_invoice_id: (inv as any).id,
          source_invoice_no: invoiceNo,
          source_product_name: carryoverOutProduct?.trim() || finalProductName,
          production_date: new Date().toISOString().slice(0, 10),
          original_qty_kg: Number(carryoverOutQty),
          remaining_qty_kg: Number(carryoverOutQty),
          unit_cost: Number(carryoverOutUnitCost.toFixed(4)),
          status: "available",
          notes: carryoverOutNotes?.trim() || null,
          created_by: user?.id || null,
          created_by_name: (user as any)?.user_metadata?.full_name || user?.email || null,
        });
        if (coErr) toast.warning("الفاتورة محفوظة لكن تعذر حفظ رصيد العجينة المتبقية: " + coErr.message);
      }

      // Carryover-IN: record usage + decrement remaining
      if (carryoverInId && selectedCarryover && Number(carryoverInQty) > 0) {
        const { error: uErr } = await supabase.from("meat_factory_carryover_dough_usage" as any).insert({
          carryover_id: carryoverInId,
          used_in_invoice_id: (inv as any).id,
          used_in_invoice_no: invoiceNo,
          used_qty_kg: Number(carryoverInQty),
          unit_cost_at_use: Number(selectedCarryover.unit_cost),
          used_by: user?.id || null,
          used_by_name: (user as any)?.user_metadata?.full_name || user?.email || null,
        });
        if (uErr) toast.warning("تعذر تسجيل استخدام العجينة المرحلة: " + uErr.message);
        else {
          const newRemaining = Math.max(0, Number(selectedCarryover.remaining_qty_kg) - Number(carryoverInQty));
          const newStatus = newRemaining <= 0.0001 ? "used" : "partial";
          await supabase.from("meat_factory_carryover_dough" as any).update({
            remaining_qty_kg: newRemaining,
            status: newStatus,
          }).eq("id", carryoverInId);
        }
      }

      // If this save was an authorized duplicate-override, record final audit pointing at the new invoice
      if (override) {
        try {
          await supabase.from("meat_factory_audit_log" as any).insert({
            table_name: "meat_manufacturing_invoices",
            row_id: (inv as any).id,
            action: "duplicate_override_saved",
            new_value: {
              new_invoice_id: (inv as any).id,
              new_invoice_no: invoiceNo,
              similar_invoice_id: override.similarId,
              override_reason: override.reason,
              product: finalProductName,
              finished_qty: finishedQty,
              factory_warehouse_id: factoryWarehouseId,
            },
            performed_by: user?.id || null,
          });
        } catch { /* non-fatal */ }
      }

      toast.success(`تم حفظ الفاتورة ${invoiceNo} بحالة مسودة — اضغط اعتماد للخصم`);

      resetForm();
      await fetchAll();
      setTab("list");
    } catch (e: any) {
      toast.error(e.message || "فشل حفظ الفاتورة");
    } finally {
      setSaving(false);
    }
  };

  const approve = async (id: string) => {
    if (!isApprover) { toast.error("الاعتماد متاح للمدير العام/التنفيذي/مدير المصنع فقط"); return; }
    const { count } = await supabase.from("meat_manufacturing_invoice_lines" as any)
      .select("id", { count: "exact", head: true }).eq("invoice_id", id);
    if (!count || count === 0) {
      toast.error("لا يمكن اعتماد فاتورة تصنيع بدون بنود خامات وتغليف");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("approve_meat_manufacturing_invoice" as any, { p_invoice_id: id });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r: any = data || {};
    if (r.already_approved) {
      toast.info(r.message || "الفاتورة معتمدة بالفعل");
    } else if (r.moves_skipped > 0 || r.finished_movement_existed) {
      toast.success(r.message || "تم اعتماد الفاتورة مع منع التكرار");
    } else {
      toast.success("تم اعتماد الفاتورة وخصم الخامات والتغليف");
    }
    setViewing(null);
    await fetchAll();

  };

  const openCancel = async (inv: Invoice) => {
    if (!isApprover) { toast.error("الإلغاء متاح للمدير العام/التنفيذي/مدير المصنع/الإنتاج فقط"); return; }
    if (inv.status === "cancelled") { toast.info("الفاتورة ملغاة بالفعل"); return; }
    if (inv.status === "transferred") { toast.error("لا يمكن إلغاء فاتورة تم تحويل منتجها — اعمل تسوية إدارية"); return; }
    setCancelTarget(inv);
    setCancelReason("");
    setCancelForce(false);
    setCancelImpact(null);
    try {
      const [{ data: ls }, { data: fi }] = await Promise.all([
        supabase.from("meat_manufacturing_invoice_lines" as any).select("*").eq("invoice_id", inv.id).order("kind"),
        inv.finished_item_id
          ? supabase.from("inventory_items").select("name, stock").eq("id", inv.finished_item_id).maybeSingle()
          : Promise.resolve({ data: null } as any),
      ]);
      setCancelImpact({
        lines: ls || [],
        finishedStock: fi ? Number((fi as any).stock || 0) : null,
        finishedItemName: fi ? (fi as any).name : null,
      });
    } catch (e: any) {
      toast.error("تعذر تحميل بيانات الفاتورة: " + e.message);
    }
  };

  const submitCancel = async () => {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (reason.length < 3) { toast.error("اكتب سبب الإلغاء (٣ أحرف على الأقل)"); return; }
    setCancelling(true);
    const { data, error } = await supabase.rpc("cancel_meat_manufacturing_invoice" as any, {
      p_invoice_id: cancelTarget.id,
      p_reason: reason,
      p_force_partial: !!cancelForce,
    });
    setCancelling(false);
    if (error) { toast.error(error.message); return; }
    const r: any = data || {};
    toast.success(r.message || "تم إلغاء الفاتورة وعكس أثر المخزون");
    setCancelTarget(null);
    setCancelReason("");
    setCancelForce(false);
    setCancelImpact(null);
    setViewing(null);
    await fetchAll();
  };

  const openTransfer = (inv: Invoice) => { setTransferInv(inv); setTransferDestId(mainWarehouses[0]?.id || ""); };
  const submitTransfer = async () => {
    if (!transferInv || !transferDestId) { toast.error("اختر المخزن الرئيسي"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("transfer_meat_invoice_to_warehouse" as any, {
      p_invoice_id: transferInv.id, p_destination_warehouse_id: transferDestId, p_notes: null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const r: any = data || {};
    toast.success(`تم إرسال التحويل ${r.transfer_no || ""} — بانتظار موافقة المخزن الرئيسي`);
    setTransferInv(null);
    await fetchAll();
  };

  const openView = async (inv: Invoice) => {
    setViewing(inv);
    const { data } = await supabase.from("meat_manufacturing_invoice_lines" as any).select("*").eq("invoice_id", inv.id).order("kind");
    setViewLines(data || []);
  };

  const printInvoice = async (inv: Invoice) => {
    const { data: ls } = await supabase.from("meat_manufacturing_invoice_lines" as any).select("*").eq("invoice_id", inv.id);
    const lines = (ls || []) as any[];
    const rawRows = lines.filter(l => l.kind !== "packaging");
    const packRows = lines.filter(l => l.kind === "packaging");
    const rowHtml = (l: any) => `<tr>
      <td>${esc(l.item_name)}</td><td>${esc(KIND_LABEL[(l.kind as Kind) || "raw"])}</td>
      <td>${esc(l.unit || "")}</td><td>${fmt(l.quantity)}</td>
      <td>${fmt(l.unit_cost)}</td><td>${fmt(l.line_total)}</td>
      <td>${l.stock_before != null ? fmt(l.stock_before) : "—"}</td>
      <td>${l.stock_after != null ? fmt(l.stock_after) : "—"}</td>
    </tr>`;
    const w = window.open("", "_blank", "width=950,height=720");
    if (!w) return toast.error("فعّل النوافذ المنبثقة للطباعة");
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"/><title>فاتورة تصنيع ${esc(inv.invoice_no || "")}</title>
      <style>*{box-sizing:border-box;font-family:'Cairo','Tajawal',Arial,sans-serif}body{padding:24px;color:#111}
      .header{display:flex;justify-content:space-between;border-bottom:2px solid #7c3aed;padding-bottom:10px;margin-bottom:14px}
      .brand{color:#7c3aed;font-weight:bold;font-size:22px}
      h2{font-size:15px;margin:18px 0 6px;color:#7c3aed}
      .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;color:#444;font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-top:6px}
      th,td{border:1px solid #ccc;padding:6px 8px;font-size:13px;text-align:right}
      th{background:#ede9fe}tfoot td{font-weight:bold;background:#fafafa}
      .summary{margin-top:14px;border:2px solid #7c3aed;border-radius:8px;padding:12px;background:#faf5ff}
      .summary table{margin:0}.summary th{background:#7c3aed;color:#fff}
      .signs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:60px;text-align:center}
      .signs div{border-top:1px solid #999;padding-top:6px;font-size:13px}
      @media print{button{display:none}}</style></head><body>
      <div class="header"><div class="brand">نعام العاصمة</div><div>فاتورة تصنيع مصنع اللحوم</div></div>
      <div class="meta">
        <div><b>رقم الفاتورة:</b> ${esc(inv.invoice_no || "—")}</div>
        <div><b>التاريخ:</b> ${esc((inv.created_at || "").slice(0,10))}</div>
        <div><b>الحالة:</b> ${esc(inv.status)}</div>
        <div><b>المنتج النهائي:</b> ${esc(inv.product_name)}</div>
        <div><b>الكمية المنتجة:</b> ${fmt(inv.finished_qty)} ${esc(inv.unit)}</div>
        <div><b>وجهة المنتج:</b> ${inv.destination_kind === "main_warehouse_direct" ? "المخزن الرئيسي مباشرة" : "مخزن مصنع اللحوم"}</div>
      </div>

      <h2>المواد الخام والبهارات المستخدمة</h2>
      <table><thead><tr><th>الصنف</th><th>النوع</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>المخزون قبل</th><th>المخزون بعد</th></tr></thead>
      <tbody>${rawRows.map(rowHtml).join("") || `<tr><td colspan="8" style="text-align:center">لا توجد</td></tr>`}</tbody></table>

      <h2>خامات التغليف المستخدمة</h2>
      <table><thead><tr><th>الصنف</th><th>النوع</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>المخزون قبل</th><th>المخزون بعد</th></tr></thead>
      <tbody>${packRows.map(rowHtml).join("") || `<tr><td colspan="8" style="text-align:center">لا توجد</td></tr>`}</tbody></table>

      <h2>المواد الخدمية / التكاليف الإضافية</h2>
      ${(() => {
        const svc = parseServiceCostsFromNotes(inv.notes);
        const svcTotal = svc.reduce((s, r) => s + Number(r.total || 0), 0);
        const residual = Math.max(0, Number(inv.extra_cost || 0) - svcTotal);
        const effectiveExtra = Math.max(Number(inv.extra_cost || 0), svcTotal);
        (inv as any).__effective_extra = effectiveExtra;
        if (svc.length === 0 && residual === 0) {
          return `<table><tbody><tr><td style="text-align:center;color:#666">لا توجد مواد خدمية في هذه الفاتورة</td></tr></tbody></table>`;
        }
        const rows = svc.map(r => `<tr>
          <td>${esc(r.name || "مادة خدمية")}</td>
          <td>تكلفة تشغيل</td>
          <td>${r.quantity != null ? fmt(r.quantity) : "—"}</td>
          <td>${esc(r.unit || "—")}</td>
          <td>${r.unit_cost != null ? fmt(r.unit_cost) : "—"}</td>
          <td>${r.total != null ? fmt(r.total) : "—"}</td>
          <td>${esc(r.name || "")}</td>
        </tr>`).join("");
        const residualRow = residual > 0 ? `<tr>
          <td>تكلفة إضافية</td><td>تكلفة تشغيل</td><td>—</td><td>—</td><td>—</td>
          <td>${fmt(residual)}</td><td>رقم إجمالي بدون كمية</td>
        </tr>` : "";
        return `<table>
          <thead><tr><th>اسم البند</th><th>النوع</th><th>الكمية</th><th>الوحدة</th><th>سعر الوحدة</th><th>الإجمالي</th><th>ملاحظات</th></tr></thead>
          <tbody>${rows}${residualRow}</tbody>
          <tfoot><tr><td colspan="5" style="text-align:left">إجمالي المواد الخدمية</td><td colspan="2">${fmt(effectiveExtra)} ج</td></tr></tfoot>
        </table>`;
      })()}

      ${(() => {
        const effectiveExtra = Number((inv as any).__effective_extra ?? inv.extra_cost ?? 0);
        const base = Number(inv.raw_cost || 0) + Number(inv.spice_cost || 0) + Number(inv.packaging_cost || 0);
        const effectiveTotal = Math.max(Number(inv.total_manufacturing_cost || 0), base + effectiveExtra);
        const qty = Number(inv.finished_qty || 0);
        const effectiveUnit = qty > 0 ? effectiveTotal / qty : Number(inv.unit_cost || 0);
        return `<div class="summary">
        <table>
          <tr><th>إجمالي تكلفة الخامات</th><td>${fmt(inv.raw_cost)} ج</td><th>إجمالي تكلفة البهارات</th><td>${fmt(inv.spice_cost)} ج</td></tr>
          <tr><th>إجمالي تكلفة التغليف</th><td>${fmt(inv.packaging_cost)} ج</td><th>إجمالي المواد الخدمية</th><td>${fmt(effectiveExtra)} ج</td></tr>
          <tr><th>إجمالي تكلفة التصنيع</th><td>${fmt(effectiveTotal)} ج</td><th>تكلفة الوحدة</th><td>${fmt(effectiveUnit)} ج / ${esc(inv.unit)}</td></tr>
        </table>
      </div>`;
      })()}

      ${userNotesFromInvoice(inv.notes) ? `<div style="margin-top:14px"><b>ملاحظات:</b> ${esc(userNotesFromInvoice(inv.notes))}</div>` : ""}
      <div class="signs"><div>مسؤول مصنع اللحوم</div><div>مشرف المخزن</div><div>المدير المعتمد</div></div>
      <div style="text-align:center;margin-top:18px"><button onclick="window.print()" style="padding:8px 22px;background:#7c3aed;color:#fff;border:0;border-radius:6px;cursor:pointer">طباعة</button></div>
      </body></html>`);
    w.document.close();
  };

  const statusBadge = (s: string, inv?: Invoice) => {
    if (s === "draft") return <Badge variant="outline">مسودة</Badge>;
    if (s === "approved") return <Badge className="bg-emerald-600">معتمدة</Badge>;
    if (s === "transferred") {
      if (inv?.legacy_transferred) return <Badge className="bg-slate-500">تم توريدها سابقًا</Badge>;
      const tstatus = inv?.transfer_id ? transferStatusMap[inv.transfer_id] : null;
      if (tstatus === "received") return <Badge className="bg-emerald-700">تم الاستلام بالمخزن الرئيسي</Badge>;
      return <Badge className="bg-amber-500">بانتظار استلام المخزن الرئيسي</Badge>;
    }
    if (s === "rejected") return <Badge variant="destructive">مرفوضة</Badge>;
    if (s === "cancelled") return <Badge variant="secondary">ملغاة</Badge>;
    return <Badge>{s}</Badge>;
  };

  const renderLineTable = (
    lines: Line[],
    setter: (fn: (ls: Line[]) => Line[]) => void,
    candidates: RawItem[],
    kindLabel: string,
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{kindLabel}</h3>
        <Button onClick={() => setter(ls => [...ls, newLine(candidates === packCandidates ? "packaging" : "raw")])} size="sm" variant="outline">
          <Plus className="w-4 h-4 ml-1" /> إضافة سطر
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>الصنف</TableHead>
            <TableHead>النوع</TableHead>
            <TableHead>الوحدة</TableHead>
            <TableHead>المتاح</TableHead>
            <TableHead>الكمية</TableHead>
            <TableHead>سعر الوحدة</TableHead>
            <TableHead>الإجمالي</TableHead>
            <TableHead>المتوقع بعد</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.length === 0 ? (
            <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-4">لا توجد أصناف</TableCell></TableRow>
          ) : lines.map(l => {
            const it = candidates.find(x => x.id === l.item_id);
            const after = it ? Number(it.current_stock) - Number(l.quantity || 0) : null;
            const insufficient = it && Number(l.quantity || 0) > Number(it.current_stock || 0);
            return (
              <TableRow key={l.tmp} className={insufficient ? "bg-red-50 dark:bg-red-950/30" : ""}>
                <TableCell className="min-w-[200px]">
                  <Select value={l.item_id} onValueChange={v => updateLine(setter, candidates, l.tmp, { item_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر صنف" /></SelectTrigger>
                    <SelectContent className="max-h-80">
                      {candidates.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="text-xs text-muted-foreground ml-2">[{KIND_LABEL[c.kind]}]</span>{c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Badge variant="outline" className="text-xs">{KIND_LABEL[l.kind]}</Badge></TableCell>
                <TableCell className="text-xs">{l.unit}</TableCell>
                <TableCell className="text-xs">{it ? fmt(it.current_stock) : "—"}</TableCell>
                <TableCell><Input type="number" step="0.01" className="w-24" value={l.quantity || ""} onChange={e => updateLine(setter, candidates, l.tmp, { quantity: Number(e.target.value) })} /></TableCell>
                <TableCell><Input type="number" step="0.01" className="w-24" value={l.unit_cost || ""} onChange={e => updateLine(setter, candidates, l.tmp, { unit_cost: Number(e.target.value) })} /></TableCell>
                <TableCell className="font-medium">{fmt(l.line_total)}</TableCell>
                <TableCell className={insufficient ? "text-red-600 font-bold" : "text-muted-foreground"}>{after != null ? fmt(after) : "—"}</TableCell>
                <TableCell><Button size="icon" variant="ghost" onClick={() => setter(ls => ls.filter(x => x.tmp !== l.tmp))}><Trash2 className="w-4 h-4 text-red-600" /></Button></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <Factory className="w-7 h-7 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold">فواتير تصنيع مصنع اللحوم</h1>
            <p className="text-sm text-muted-foreground">جدولان منفصلان للخامات والتغليف. الخصم وإضافة المنتج النهائي يتم فقط بعد اعتماد المدير.</p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="new">فاتورة جديدة</TabsTrigger>
            <TabsTrigger value="list">سجل التصنيع ({invoices.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="new" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">بيانات الفاتورة</CardTitle>
                <CardDescription>تُحفظ بحالة مسودة. الاعتماد يخصم الكميات ويضيف المنتج النهائي.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 border border-purple-200 bg-purple-50/50 dark:bg-purple-950/20 rounded-md flex flex-wrap items-end gap-2">
                  <ChefHat className="w-5 h-5 text-purple-600 mb-2" />
                  <div className="flex-1 min-w-[200px]">
                    <Label className="text-xs">اختيار تركيبة جاهزة (يحمّل الخامات تلقائيًا)</Label>
                    <Select value={selectedRecipeKey} onValueChange={v => loadRecipe(v, finishedQty || undefined)}>
                      <SelectTrigger><SelectValue placeholder="— اختر تركيبة —" /></SelectTrigger>
                      <SelectContent>{MEAT_RECIPES.map(r => <SelectItem key={r.key} value={r.key}>{r.product} (تشغيلة {r.batch_qty} {r.unit})</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  {selectedRecipeKey && (
                    <Button size="sm" variant="outline" onClick={() => { setSelectedRecipeKey(""); resetForm(); }}>إلغاء التركيبة</Button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label>مخزن مصنع اللحوم</Label>
                    <Select value={factoryWarehouseId} onValueChange={setFactoryWarehouseId}>
                      <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                      <SelectContent>{factoryWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>المنتج النهائي</Label>
                    <Select value={productName} onValueChange={setProductName}>
                      <SelectTrigger><SelectValue placeholder="اختر المنتج" /></SelectTrigger>
                      <SelectContent>
                        {PRODUCT_PRESETS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        <SelectItem value="أخرى">أخرى (أدخل اسمًا)</SelectItem>
                      </SelectContent>
                    </Select>
                    {productName === "أخرى" && (
                      <Input className="mt-2" placeholder="اسم المنتج" value={productNameOther} onChange={e => setProductNameOther(e.target.value)} />
                    )}
                  </div>
                  <div><Label>الكمية النهائية</Label><Input type="number" step="0.01" value={finishedQty || ""} onChange={e => setFinishedQty(Number(e.target.value))} /></div>
                  <div>
                    <Label>الوحدة</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="كجم">كجم</SelectItem><SelectItem value="عبوة">عبوة</SelectItem><SelectItem value="قطعة">قطعة</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Label>وجهة المنتج النهائي</Label>
                    <Select value={destinationKind} onValueChange={v => setDestinationKind(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="factory_warehouse">مخزن مصنع اللحوم (التوريد للمخزن الرئيسي لاحقًا)</SelectItem>
                        <SelectItem value="main_warehouse_direct">توريد مباشر للمخزن الرئيسي</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>تكلفة إضافية</Label><Input type="number" step="0.01" value={extraCost || ""} onChange={e => setExtraCost(Number(e.target.value))} /></div>
                </div>

                {unmappedLines.length > 0 && (
                  <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 text-amber-800 dark:text-amber-200">
                        <AlertTriangle className="w-5 h-5" />
                        مطابقة أصناف التركيبة مع المخزون ({unmappedLines.length})
                      </CardTitle>
                      <CardDescription>
                        هذه الأصناف غير مرتبطة بمخزون مصنع اللحوم. اختر البديل الصحيح أو أنشئ الصنف في المخزون. لا يتم الاعتماد قبل اكتمال الربط.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>اسم الصنف في التركيبة</TableHead>
                            <TableHead>النوع</TableHead>
                            <TableHead>الوحدة</TableHead>
                            <TableHead>الكمية المطلوبة</TableHead>
                            <TableHead>الصنف البديل من المخزون</TableHead>
                            <TableHead>الرصيد</TableHead>
                            <TableHead>متوسط التكلفة</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {unmappedLines.map(l => {
                            const cands = l.kind === "packaging" ? packCandidates : rawCandidates;
                            return (
                              <TableRow key={l.tmp}>
                                <TableCell className="font-medium">{l.item_name}</TableCell>
                                <TableCell><Badge variant="outline">{KIND_LABEL[l.kind]}</Badge></TableCell>
                                <TableCell className="text-xs">{l.unit}</TableCell>
                                <TableCell>{fmt(l.quantity)}</TableCell>
                                <TableCell className="min-w-[260px]">
                                  <Select onValueChange={v => saveMapping(l.item_name, l.kind, v)}>
                                    <SelectTrigger><SelectValue placeholder="اختر بديلًا من المخزون" /></SelectTrigger>
                                    <SelectContent className="max-h-80">
                                      {cands.map(c => (
                                        <SelectItem key={c.id} value={c.id}>
                                          {c.name} <span className="text-xs text-muted-foreground">— {c.unit} — رصيد {fmt(c.current_stock)} — متوسط {fmt(c.avg_cost)}</span>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="text-xs">—</TableCell>
                                <TableCell className="text-xs">—</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                      <div className="text-xs text-amber-700 dark:text-amber-300 mt-3 flex items-center gap-1">
                        <Link2 className="w-3 h-3" /> الربط يُحفظ في جدول مطابقة الأصناف ويُستخدم تلقائيًا للتركيبات اللاحقة.
                      </div>
                    </CardContent>
                  </Card>
                )}

                {insufficientLines.length > 0 && unmappedLines.length === 0 && (
                  <div className="p-3 border border-red-300 bg-red-50 dark:bg-red-950/20 rounded-md text-sm text-red-700 dark:text-red-300">
                    <div className="flex items-center gap-2 font-semibold mb-1"><AlertTriangle className="w-4 h-4" /> رصيد غير كافٍ</div>
                    <ul className="list-disc pr-5 space-y-0.5">
                      {insufficientLines.map(l => {
                        const it = items.find(x => x.id === l.item_id);
                        return <li key={l.tmp}>الرصيد غير كافٍ للصنف: <b>{l.item_name}</b> — المطلوب: {fmt(l.quantity)}، المتاح: {fmt(it?.current_stock || 0)}.</li>;
                      })}
                    </ul>
                  </div>
                )}

                {/* Service-cost auto-table removed — extra cost is a single manual numeric field above. */}


                {renderLineTable(rawLines, setRawLines, rawCandidates, "المواد الخام والبهارات المستخدمة")}
                {(() => {
                  const totalPackInStock = packCandidates.filter(c => Number(c.current_stock || 0) > 0).length;
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={packSearch}
                          onChange={e => setPackSearch(e.target.value)}
                          placeholder="ابحث في خامات التغليف (طبق، أكياس، استيكر، علبة …)"
                          className="max-w-md"
                        />
                        <span className="text-xs text-muted-foreground">
                          {packCandidatesFiltered.length} / {totalPackInStock} متاح
                        </span>
                      </div>
                      {totalPackInStock === 0 && (
                        <div className="text-xs text-amber-700 dark:text-amber-300 border border-amber-300 bg-amber-50 dark:bg-amber-950/20 rounded p-2">
                          ⚠ لا توجد أي خامة تغليف برصيد متاح. تأكد من اعتماد فاتورة شراء التغليف الخاصة بالأطباق/الأكياس.
                        </div>
                      )}
                      {renderLineTable(packLines, setPackLines, packCandidatesFiltered, "خامات التغليف المستخدمة")}
                    </div>
                  );
                })()}


                {/* ===== Carryover dough IN — use available leftover dough ===== */}
                <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
                      استخدام عجينة مرحلة (اختياري)
                    </CardTitle>
                    <CardDescription className="text-xs">
                      اختر يدويًا رصيد عجينة متبقية من فاتورة سابقة لإضافة قيمتها لهذه الفاتورة. الخامات لن تُخصم مرة أخرى.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">رصيد العجينة المرحلة</Label>
                      <Select value={carryoverInId || "__none__"} onValueChange={v => { setCarryoverInId(v === "__none__" ? "" : v); setCarryoverInQty(0); }}>
                        <SelectTrigger><SelectValue placeholder="— بدون —" /></SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">— بدون استخدام عجينة مرحلة —</SelectItem>
                          {availableCarryovers.map(c => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.source_product_name} — متاح {fmt(c.remaining_qty_kg)} كجم × {fmt(c.unit_cost)} ج
                              {c.source_invoice_no ? ` (فاتورة ${c.source_invoice_no})` : ""}
                            </SelectItem>
                          ))}
                          {availableCarryovers.length === 0 && (
                            <div className="text-xs text-muted-foreground px-3 py-2">لا يوجد رصيد عجينة مرحلة متاح</div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">الكمية المستخدمة (كجم)</Label>
                      <Input
                        type="number" step="0.001" min={0}
                        max={selectedCarryover?.remaining_qty_kg || undefined}
                        disabled={!carryoverInId}
                        value={carryoverInQty || ""}
                        onChange={e => setCarryoverInQty(Number(e.target.value))}
                      />
                      {selectedCarryover && (
                        <div className="text-[11px] text-muted-foreground mt-1">
                          المتاح: <b className="text-emerald-700">{fmt(selectedCarryover.remaining_qty_kg)}</b> كجم — تكلفة الكيلو: <b>{fmt(selectedCarryover.unit_cost)}</b> ج
                        </div>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">قيمة العجينة المستخدمة</Label>
                      <div className="h-10 flex items-center px-3 rounded-md border bg-background font-bold text-emerald-700">
                        {fmt(carryoverInCost)} ج
                      </div>
                      {carryoverInError && (
                        <div className="text-[11px] text-rose-700 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> {carryoverInError}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* ===== Carryover dough OUT — leftover dough from this invoice ===== */}
                <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 text-amber-800 dark:text-amber-200">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={hasCarryoverOut}
                          onChange={e => setHasCarryoverOut(e.target.checked)}
                          className="w-4 h-4 accent-amber-600"
                        />
                        يوجد عجينة متبقية
                      </label>
                    </CardTitle>
                    <CardDescription className="text-xs">
                      سجّل العجينة الصالحة التي تبقّت في المكبس/الماكينة لتدخل كرصيد في فاتورة تصنيع لاحقة. لن تُحتسب تالف ولن تدخل المنتج النهائي.
                    </CardDescription>
                  </CardHeader>
                  {hasCarryoverOut && (
                    <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <Label className="text-xs">الكمية المتبقية (كجم)</Label>
                        <Input
                          type="number" step="0.001" min={0}
                          value={carryoverOutQty || ""}
                          onChange={e => setCarryoverOutQty(Number(e.target.value))}
                        />
                        <div className="text-[11px] text-muted-foreground mt-1">
                          تكلفة الكيلو المحتسبة: <b className="text-amber-700">{fmt(carryoverOutUnitCost)}</b> ج
                          (الخامات ÷ المنتج + المتبقي)
                        </div>
                      </div>
                      <div>
                        <Label className="text-xs">نوع العجينة / المنتج الأصلي</Label>
                        <Input
                          placeholder={finalProductName || "مثال: عجينة كفتة"}
                          value={carryoverOutProduct}
                          onChange={e => setCarryoverOutProduct(e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">ملاحظات</Label>
                        <Input
                          placeholder="اختياري"
                          value={carryoverOutNotes}
                          onChange={e => setCarryoverOutNotes(e.target.value)}
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>

                <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20">
                  <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div><div className="text-muted-foreground">إجمالي الخامات</div><div className="font-bold text-lg">{fmt(rawCost)}</div></div>
                    <div><div className="text-muted-foreground">إجمالي البهارات</div><div className="font-bold text-lg">{fmt(spiceCost)}</div></div>
                    <div><div className="text-muted-foreground">إجمالي التغليف</div><div className="font-bold text-lg">{fmt(packCost)}</div></div>
                    <div><div className="text-muted-foreground">مصروفات إضافية</div><div className="font-bold text-lg">{fmt(totalExtraCost)}</div></div>
                    <div className="col-span-2"><div className="text-muted-foreground">إجمالي تكلفة الفاتورة</div><div className="font-bold text-xl text-purple-700">{fmt(totalCost)} ج</div></div>
                    <div><div className="text-muted-foreground">المنتج النهائي</div><div className="font-bold text-lg">{fmt(finishedQty)} {unit}</div></div>
                    <div><div className="text-muted-foreground">عجينة متبقية</div><div className="font-bold text-lg text-amber-700">{fmt(carryoverOutQty)} {unit}</div></div>
                    <div className="col-span-2"><div className="text-muted-foreground">إجمالي كمية التصنيع</div><div className="font-bold text-lg">{fmt(totalManufacturedQty)} {unit}</div></div>
                    <div className="col-span-2"><div className="text-muted-foreground">تكلفة الكيلو (على {fmt(totalManufacturedQty)} {unit})</div><div className="font-bold text-xl text-purple-700">{fmt(unitCost)} ج / {unit}</div></div>
                    <div><div className="text-muted-foreground">تكلفة المنتج النهائي</div><div className="font-bold text-lg text-emerald-700">{fmt(finishedProductCost)} ج</div></div>
                    <div><div className="text-muted-foreground">قيمة العجينة المرحلة</div><div className="font-bold text-lg text-amber-700">{fmt(carryoverOutValue)} ج</div></div>
                  </CardContent>
                </Card>

                <div><Label>ملاحظات</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="اختياري" /></div>

                <div className="flex justify-end">
                  <Button onClick={() => submitDraft()} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
                    {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                    حفظ الفاتورة (مسودة)
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="list" className="space-y-3">
            {invoices.length === 0 ? (
              <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد فواتير</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>رقم</TableHead>
                        <TableHead>المنتج</TableHead>
                        <TableHead>الكمية</TableHead>
                        <TableHead>خامات</TableHead>
                        <TableHead>تغليف</TableHead>
                        <TableHead>إجمالي</TableHead>
                        <TableHead>تكلفة الوحدة</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>إجراءات</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map(inv => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-mono text-xs">{inv.invoice_no}</TableCell>
                          <TableCell className="font-medium">{inv.product_name}</TableCell>
                          <TableCell>{fmt(inv.finished_qty)} {inv.unit}</TableCell>
                          <TableCell>{fmt(Number(inv.raw_cost)+Number(inv.spice_cost))}</TableCell>
                          <TableCell>{fmt(inv.packaging_cost)}</TableCell>
                          <TableCell>{fmt(inv.total_manufacturing_cost || inv.materials_total_cost)}</TableCell>
                          <TableCell>{inv.unit_cost ? fmt(inv.unit_cost) : "—"}</TableCell>
                          <TableCell>{statusBadge(inv.status, inv)}</TableCell>
                          <TableCell className="space-x-1 space-x-reverse">
                            <Button size="sm" variant="outline" onClick={() => openView(inv)}><Eye className="w-3 h-3 ml-1" />عرض</Button>
                            <Button size="sm" variant="outline" onClick={() => printInvoice(inv)}><Printer className="w-3 h-3 ml-1" />طباعة</Button>
                            {inv.status === "draft" && isApprover && (
                              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => approve(inv.id)} disabled={busy}>
                                <CheckCircle2 className="w-3 h-3 ml-1" />اعتماد
                              </Button>
                            )}
                            {inv.status === "approved" && (
                              <Button size="sm" onClick={() => openTransfer(inv)} className="bg-blue-600 hover:bg-blue-700">
                                <Send className="w-3 h-3 ml-1" />توريد الرئيسي
                              </Button>
                            )}
                            {inv.status === "transferred" && !inv.legacy_transferred && inv.transfer_no && inv.transfer_no !== "LEGACY" && (
                              <span className="text-xs text-muted-foreground">#{inv.transfer_no}</span>
                            )}
                            {isApprover && (inv.status === "draft" || inv.status === "approved") && (
                              <Button size="sm" variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => openCancel(inv)}>
                                <Ban className="w-3 h-3 ml-1" />إلغاء
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={!!viewing} onOpenChange={(v) => !v && setViewing(null)}>
          <DialogContent className="max-w-4xl" dir="rtl">
            <DialogHeader><DialogTitle>تفاصيل فاتورة {viewing?.invoice_no}</DialogTitle></DialogHeader>
            {viewing && (
              <div className="space-y-3 text-sm max-h-[70vh] overflow-y-auto">
                {(() => {
                  const svcTotal = parseServiceCostsFromNotes(viewing.notes).reduce((s, x) => s + Number(x.total || 0), 0);
                  const effExtra = Math.max(Number(viewing.extra_cost || 0), svcTotal);
                  const base = Number(viewing.raw_cost || 0) + Number(viewing.spice_cost || 0) + Number(viewing.packaging_cost || 0);
                  const effTotal = Math.max(Number(viewing.total_manufacturing_cost || 0), base + effExtra);
                  const qty = Number(viewing.finished_qty || 0);
                  const effUnit = qty > 0 ? effTotal / qty : Number(viewing.unit_cost || 0);
                  return (
                    <div className="grid grid-cols-3 gap-2">
                      <div><b>المنتج:</b> {viewing.product_name}</div>
                      <div><b>الكمية:</b> {fmt(viewing.finished_qty)} {viewing.unit}</div>
                      <div><b>الحالة:</b> {statusBadge(viewing.status)}</div>
                      <div><b>إجمالي الخامات:</b> {fmt(viewing.raw_cost)}</div>
                      <div><b>إجمالي البهارات:</b> {fmt(viewing.spice_cost)}</div>
                      <div><b>إجمالي التغليف:</b> {fmt(viewing.packaging_cost)}</div>
                      <div><b>إجمالي المواد الخدمية:</b> {fmt(effExtra)}</div>
                      <div><b>الإجمالي:</b> {fmt(effTotal)}</div>
                      <div><b>تكلفة الوحدة:</b> {fmt(effUnit)}</div>
                      <div><b>التاريخ:</b> {(viewing.created_at || "").slice(0,10)}</div>
                    </div>
                  );
                })()}
                {viewLines.length === 0 ? (
                  <div className="border-2 border-dashed border-amber-400 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-4 space-y-3">
                    <div className="text-amber-900 dark:text-amber-200 text-sm font-semibold">
                      ⚠️ فاتورة قديمة بدون بنود خامات محفوظة — لا يُنصح باعتمادها.
                    </div>
                    <div className="text-xs text-amber-800 dark:text-amber-300">
                      لن يتم خصم أي خامات أو إضافة منتج نهائي للمخزون، ولن تدخل هذه الفاتورة في تقارير التصنيع المعتمدة. يمكن إدخال البنود يدويًا أدناه إذا أردت استكمالها.
                    </div>
                    {viewing.status === "draft" && isApprover && (
                      <AddLinesForViewedInvoice
                        invoice={viewing}
                        rawCandidates={rawCandidates}
                        packCandidates={packCandidates}
                        onSaved={async () => { await openView(viewing); await fetchAll(); }}
                      />
                    )}
                  </div>
                ) : (() => {
                  const rawSpice = viewLines.filter((l: any) => l.kind !== "packaging");
                  const pack = viewLines.filter((l: any) => l.kind === "packaging");
                  const isDraft = viewing.status === "draft";
                  const renderTable = (rows: any[], title: string, emptyText: string) => (
                    <div className="space-y-1">
                      <h3 className="font-semibold text-sm text-purple-700">{title}</h3>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الصنف</TableHead>
                            <TableHead>النوع</TableHead>
                            <TableHead>الوحدة</TableHead>
                            <TableHead>الكمية</TableHead>
                            <TableHead>سعر الوحدة</TableHead>
                            <TableHead>إجمالي السطر</TableHead>
                            <TableHead>الرصيد قبل</TableHead>
                            <TableHead>الرصيد بعد</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.length === 0 ? (
                            <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-3">{emptyText}</TableCell></TableRow>
                          ) : rows.map((l: any) => (
                            <TableRow key={l.id}>
                              <TableCell className="font-medium">{l.item_name}</TableCell>
                              <TableCell><Badge variant="outline">{KIND_LABEL[(l.kind as Kind)||"raw"]}</Badge></TableCell>
                              <TableCell>{l.unit}</TableCell>
                              <TableCell>{fmt(l.quantity)}</TableCell>
                              <TableCell>{fmt(l.unit_cost)}</TableCell>
                              <TableCell className="font-semibold">{fmt(l.line_total)}</TableCell>
                              <TableCell>{isDraft ? <span className="text-muted-foreground text-xs">لم تعتمد بعد</span> : (l.stock_before != null ? fmt(l.stock_before) : "—")}</TableCell>
                              <TableCell>{isDraft ? <span className="text-muted-foreground text-xs">لم تعتمد بعد</span> : (l.stock_after != null ? fmt(l.stock_after) : "—")}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  );
                  const svcRows = parseServiceCostsFromNotes(viewing.notes);
                  const svcTotal = svcRows.reduce((s, r) => s + Number(r.total || 0), 0);
                  const extraResidual = Math.max(0, Number(viewing.extra_cost || 0) - svcTotal);
                  return (
                    <div className="space-y-4">
                      {renderTable(rawSpice, "المواد الخام والبهارات المستخدمة", "لا توجد خامات/بهارات")}
                      {renderTable(pack, "خامات التغليف المستخدمة", "لا توجد خامات تغليف")}

                      <div className="space-y-1">
                        <h3 className="font-semibold text-sm text-purple-700">المواد الخدمية / التكاليف الإضافية</h3>
                        {svcRows.length === 0 && extraResidual === 0 ? (
                          <div className="text-xs text-muted-foreground border rounded-md px-3 py-2 bg-muted/30">
                            لا توجد مواد خدمية في هذه الفاتورة
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>اسم البند</TableHead>
                                <TableHead>النوع</TableHead>
                                <TableHead>الكمية</TableHead>
                                <TableHead>الوحدة</TableHead>
                                <TableHead>سعر الوحدة</TableHead>
                                <TableHead>الإجمالي</TableHead>
                                <TableHead>ملاحظات</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {svcRows.map((r, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="font-medium">{r.name || "مادة خدمية"}</TableCell>
                                  <TableCell><Badge variant="outline">تكلفة تشغيل</Badge></TableCell>
                                  <TableCell>{r.quantity != null ? fmt(r.quantity) : "—"}</TableCell>
                                  <TableCell>{r.unit || "—"}</TableCell>
                                  <TableCell>{r.unit_cost != null ? fmt(r.unit_cost) : "—"}</TableCell>
                                  <TableCell className="font-semibold">{r.total != null ? fmt(r.total) : "—"}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{r.name}</TableCell>
                                </TableRow>
                              ))}
                              {extraResidual > 0 && (
                                <TableRow>
                                  <TableCell className="font-medium">تكلفة إضافية</TableCell>
                                  <TableCell><Badge variant="outline">تكلفة تشغيل</Badge></TableCell>
                                  <TableCell>—</TableCell>
                                  <TableCell>—</TableCell>
                                  <TableCell>—</TableCell>
                                  <TableCell className="font-semibold">{fmt(extraResidual)}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">رقم إجمالي بدون كمية</TableCell>
                                </TableRow>
                              )}
                              <TableRow>
                                <TableCell colSpan={5} className="text-end font-semibold">إجمالي المواد الخدمية</TableCell>
                                <TableCell className="font-bold text-purple-700">{fmt(Math.max(Number(viewing.extra_cost || 0), svcTotal))}</TableCell>
                                <TableCell />
                              </TableRow>
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => viewing && printInvoice(viewing)}><Printer className="w-4 h-4 ml-1" />طباعة</Button>
              {viewing?.status === "draft" && isApprover && (
                <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => viewing && approve(viewing.id)}><CheckCircle2 className="w-4 h-4 ml-1" />اعتماد</Button>
              )}
              {viewing && isApprover && (viewing.status === "draft" || viewing.status === "approved") && (
                <Button variant="outline" className="border-red-300 text-red-700 hover:bg-red-50" onClick={() => viewing && openCancel(viewing)}>
                  <Ban className="w-4 h-4 ml-1" />إلغاء الفاتورة
                </Button>
              )}
              <Button variant="outline" onClick={() => setViewing(null)}>إغلاق</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!transferInv} onOpenChange={(v) => !v && setTransferInv(null)}>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle>مراجعة توريد للمخزن الرئيسي — {transferInv?.invoice_no}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg border-2 border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 p-3 space-y-2">
                <div className="text-sm font-semibold text-blue-900 dark:text-blue-200">الكميات المطلوب توريدها:</div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><b>المنتج:</b> {transferInv?.product_name}</div>
                  <div><b>الكمية:</b> {fmt(transferInv?.finished_qty)} {transferInv?.unit}</div>
                  <div className="col-span-2"><b>رقم فاتورة التصنيع:</b> <span className="font-mono">{transferInv?.invoice_no}</span></div>
                </div>
              </div>
              <div>
                <Label>المخزن الرئيسي المستلِم</Label>
                <Select value={transferDestId} onValueChange={setTransferDestId}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{mainWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <p className="text-xs text-amber-800 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded p-2">
                ⚠️ لن يزيد رصيد المخزن الرئيسي إلا بعد موافقة مسؤول المخزن على الاستلام. الفاتورة لا يمكن توريدها مرتين.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTransferInv(null)}>إلغاء</Button>
              <Button onClick={submitTransfer} disabled={busy} className="bg-blue-600 hover:bg-blue-700">
                {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Send className="w-4 h-4 ml-1" />}
                تأكيد التوريد للمخزن الرئيسي
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Duplicate-invoice warning */}
        <Dialog open={!!similarFound} onOpenChange={(v) => { if (!v) { setSimilarFound(null); setOverrideReason(""); } }}>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="w-5 h-5" />
                تنبيه: توجد فاتورة تصنيع مشابهة
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                توجد فاتورة تصنيع مسجلة بالفعل بنفس المنتج والكمية ونفس المخزن خلال آخر 24 ساعة. برجاء مراجعتها قبل المتابعة لتجنب التكرار.
              </p>
              {similarFound && (
                <div className="rounded border bg-amber-50 p-3 space-y-1">
                  <div><b>رقم الفاتورة:</b> {similarFound.invoice_no || "—"}</div>
                  <div><b>المنتج:</b> {similarFound.product_name}</div>
                  <div><b>الكمية:</b> {fmt(similarFound.finished_qty)} {similarFound.unit}</div>
                  <div><b>الحالة:</b> <Badge variant="outline">{similarFound.status}</Badge></div>
                  <div><b>تاريخ الإنشاء:</b> {new Date(similarFound.created_at).toLocaleString("ar-EG")}</div>
                  <div><b>المستخدم:</b> {similarFound.created_by_name || "—"}</div>
                </div>
              )}
              {canOverrideDuplicate ? (
                <div>
                  <Label className="text-amber-800">سبب المتابعة رغم التشابه (إلزامي للمدير)</Label>
                  <Textarea
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="مثال: فاتورة مستقلة وليست مكررة — تشغيلة منفصلة"
                    rows={2}
                  />
                </div>
              ) : (
                <div className="rounded border border-red-200 bg-red-50 p-2 text-red-700 text-xs">
                  لا يمكنك حفظ هذه الفاتورة بسبب التشابه القوي. للمتابعة يلزم اعتماد المدير العام أو التنفيذي.
                </div>
              )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setSimilarFound(null); setOverrideReason(""); }}>
                إلغاء الحفظ
              </Button>
              {similarFound && (
                <Button variant="secondary" onClick={() => {
                  const inv = invoices.find(i => i.id === similarFound.id);
                  if (inv) { setViewing(inv); openView(inv); }
                  setSimilarFound(null);
                  setOverrideReason("");
                  setTab("list");
                }}>
                  <Eye className="w-4 h-4 ml-1" /> عرض الفاتورة المشابهة
                </Button>
              )}
              {canOverrideDuplicate && similarFound && (
                <Button
                  disabled={saving || overrideReason.trim().length < 5}
                  className="bg-amber-600 hover:bg-amber-700"
                  onClick={async () => {
                    // Audit log (best-effort) BEFORE re-running the save
                    try {
                      await supabase.from("meat_factory_audit_log" as any).insert({
                        table_name: "meat_manufacturing_invoices",
                        row_id: similarFound.id,
                        action: "duplicate_override_attempt",
                        new_value: {
                          similar_invoice_id: similarFound.id,
                          similar_invoice_no: similarFound.invoice_no,
                          attempted_product: finalProductName,
                          attempted_qty: finishedQty,
                          attempted_factory_warehouse_id: factoryWarehouseId,
                          override_reason: overrideReason.trim(),
                          attempted_at: new Date().toISOString(),
                        },
                        performed_by: user?.id || null,
                      });
                    } catch { /* non-fatal */ }
                    const sid = similarFound.id;
                    const reason = overrideReason.trim();
                    setSimilarFound(null);
                    setOverrideReason("");
                    await submitDraft({ reason, similarId: sid });
                  }}
                >
                  {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
                  متابعة رغم التشابه
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel / void invoice with inventory reversal */}
        <Dialog open={!!cancelTarget} onOpenChange={(v) => { if (!v) { setCancelTarget(null); setCancelReason(""); setCancelForce(false); setCancelImpact(null); } }}>
          <DialogContent dir="rtl" className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-700">
                <Ban className="w-5 h-5" />
                إلغاء فاتورة تصنيع {cancelTarget?.invoice_no || ""}
              </DialogTitle>
            </DialogHeader>
            {cancelTarget && (
              <div className="space-y-3 text-sm max-h-[65vh] overflow-y-auto">
                <div className="rounded border bg-amber-50 p-3 space-y-1 text-xs">
                  <div><b>رقم الفاتورة:</b> {cancelTarget.invoice_no || "—"}</div>
                  <div><b>المنتج النهائي:</b> {cancelTarget.product_name} — {fmt(cancelTarget.finished_qty)} {cancelTarget.unit}</div>
                  <div><b>الحالة الحالية:</b> {statusBadge(cancelTarget.status)}</div>
                </div>

                {cancelTarget.status === "draft" ? (
                  <div className="rounded border border-blue-200 bg-blue-50 p-3 text-blue-800 text-xs">
                    هذه الفاتورة مسودة ولم تؤثر على المخزون — سيتم تحويلها إلى حالة "ملغاة" فقط دون أي حركات عكسية.
                  </div>
                ) : (
                  <>
                    <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
                      <div className="font-semibold text-red-800">سيتم تنفيذ الحركات العكسية التالية:</div>
                      <div className="text-xs space-y-1">
                        <div><b>1) إعادة الخامات والتغليف للمخزون:</b></div>
                        {!cancelImpact ? (
                          <div className="text-muted-foreground">جارٍ تحميل البنود...</div>
                        ) : cancelImpact.lines.length === 0 ? (
                          <div className="text-amber-700">لا توجد بنود خامات مسجلة لهذه الفاتورة.</div>
                        ) : (
                          <ul className="list-disc pr-5 space-y-0.5">
                            {cancelImpact.lines.map((l: any) => (
                              <li key={l.id}>
                                {l.item_name} — {fmt(l.quantity)} {l.unit} <span className="text-muted-foreground">[{KIND_LABEL[(l.kind as Kind) || "raw"]}]</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="text-xs space-y-1">
                        <div><b>2) خصم المنتج النهائي من المخزون:</b></div>
                        <div className="pr-5">
                          {cancelImpact?.finishedItemName || cancelTarget.product_name} — يجب خصم {fmt(cancelTarget.finished_qty)} {cancelTarget.unit}
                          <span className="text-muted-foreground"> (المتاح حالياً: {cancelImpact?.finishedStock != null ? fmt(cancelImpact.finishedStock) : "—"})</span>
                        </div>
                        {cancelImpact && cancelImpact.finishedStock != null && cancelImpact.finishedStock + 0.0001 < cancelTarget.finished_qty && (
                          <div className="text-red-700 font-semibold pr-5">
                            ⚠️ الرصيد الحالي أقل من الكمية المطلوب عكسها — جزء من المنتج تم صرفه أو بيعه.
                            {canForceCancel
                              ? " يمكنك تفعيل الإلغاء الجزئي أدناه."
                              : " لا يمكن الإلغاء — يجب طلب تسوية إدارية من المدير العام/التنفيذي."}
                          </div>
                        )}
                      </div>
                    </div>

                    {cancelImpact && cancelImpact.finishedStock != null && cancelImpact.finishedStock + 0.0001 < cancelTarget.finished_qty && canForceCancel && (
                      <label className="flex items-start gap-2 text-xs text-amber-800 border border-amber-300 bg-amber-50 rounded p-2">
                        <input type="checkbox" className="mt-0.5" checked={cancelForce} onChange={(e) => setCancelForce(e.target.checked)} />
                        <span>
                          إلغاء جزئي بصلاحية المدير — سيتم عكس الكمية المتاحة فقط ({fmt(cancelImpact.finishedStock)} {cancelTarget.unit}) وتسجيل الفرق في سجل التدقيق.
                        </span>
                      </label>
                    )}
                  </>
                )}

                <div>
                  <Label className="text-red-800">سبب الإلغاء (إلزامي)</Label>
                  <Textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="اكتب سبب واضح للإلغاء — مطلوب للأرشيف وسجل التدقيق"
                    rows={3}
                  />
                </div>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setCancelTarget(null); setCancelReason(""); setCancelForce(false); setCancelImpact(null); }}>
                تراجع
              </Button>
              <Button
                disabled={
                  cancelling ||
                  cancelReason.trim().length < 3 ||
                  (cancelTarget?.status === "approved"
                    && cancelImpact != null
                    && cancelImpact.finishedStock != null
                    && cancelImpact.finishedStock + 0.0001 < (cancelTarget?.finished_qty || 0)
                    && !(canForceCancel && cancelForce))
                }
                className="bg-red-600 hover:bg-red-700"
                onClick={submitCancel}
              >
                {cancelling ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Ban className="w-4 h-4 ml-1" />}
                تأكيد الإلغاء وعكس المخزون
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>


    </DashboardLayout>
  );
}

// =========== Inline form to add missing lines to an existing draft invoice ===========
function AddLinesForViewedInvoice({
  invoice, rawCandidates, packCandidates, onSaved,
}: {
  invoice: Invoice;
  rawCandidates: RawItem[];
  packCandidates: RawItem[];
  onSaved: () => Promise<void> | void;
}) {
  const allCandidates = useMemo(() => [...rawCandidates, ...packCandidates], [rawCandidates, packCandidates]);
  void allCandidates;
  const [rows, setRows] = useState<Line[]>([newLine("raw"), newLine("packaging")]);
  const [saving, setSaving] = useState(false);

  const update = (tmp: string, patch: Partial<Line>) => {
    setRows(rs => rs.map(l => {
      if (l.tmp !== tmp) return l;
      const m: Line = { ...l, ...patch };
      if (patch.item_id) {
        const it = allCandidates.find(x => x.id === patch.item_id);
        if (it) { m.item_name = it.name; m.unit = it.unit; m.kind = it.kind; if (!m.unit_cost) m.unit_cost = Number(it.avg_cost || 0); }
      }
      m.line_total = Number((Number(m.quantity || 0) * Number(m.unit_cost || 0)).toFixed(3));
      return m;
    }));
  };

  const totals = useMemo(() => {
    const raw = rows.filter(l => l.kind === "raw").reduce((s,l) => s + Number(l.line_total||0), 0);
    const spice = rows.filter(l => l.kind === "spice").reduce((s,l) => s + Number(l.line_total||0), 0);
    const pack = rows.filter(l => l.kind === "packaging").reduce((s,l) => s + Number(l.line_total||0), 0);
    return { raw, spice, pack, all: raw + spice + pack };
  }, [rows]);

  const save = async () => {
    const valid = rows.filter(l => l.item_id && l.quantity > 0);
    if (valid.length === 0) { toast.error("أضف صنفًا واحدًا على الأقل بكمية > 0"); return; }
    setSaving(true);
    try {
      const { error: e1 } = await supabase.from("meat_manufacturing_invoice_lines" as any).insert(
        valid.map(l => ({
          invoice_id: invoice.id,
          item_id: l.item_id, item_name: l.item_name, kind: l.kind,
          unit: l.unit, quantity: l.quantity, unit_cost: l.unit_cost, line_total: l.line_total,
        })) as any
      );
      if (e1) throw e1;

      const extra = Number(invoice.extra_cost || 0);
      const total = totals.all + extra;
      const unitCost = Number(invoice.finished_qty || 0) > 0 ? total / Number(invoice.finished_qty) : 0;
      const { error: e2 } = await supabase.from("meat_manufacturing_invoices" as any).update({
        raw_cost: totals.raw,
        spice_cost: totals.spice,
        packaging_cost: totals.pack,
        materials_total_cost: totals.all,
        total_manufacturing_cost: total,
        unit_cost: unitCost,
      }).eq("id", invoice.id);
      if (e2) throw e2;

      toast.success(`تم إضافة ${valid.length} بند وتحديث الإجماليات`);
      await onSaved();
    } catch (e: any) {
      toast.error(e?.message || "فشل الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const renderSection = (title: string, kindFilter: Kind[], candidates: RawItem[], defaultKind: Kind) => {
    const sectionRows = rows.filter(l => kindFilter.includes(l.kind) || (!l.item_id && l.kind === defaultKind));
    return (
      <div className="space-y-1 border rounded-md p-2 bg-white/60 dark:bg-background/40">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm text-purple-700">{title}</h4>
          <span className="text-xs text-muted-foreground">عدد الأصناف المتاحة: {candidates.length}</span>
        </div>
        {candidates.length === 0 && (
          <div className="text-xs text-red-600">لا توجد أصناف نشطة في مخزن خامات مصنع اللحوم لهذا النوع.</div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الصنف</TableHead>
              <TableHead>الوحدة</TableHead>
              <TableHead>الكمية</TableHead>
              <TableHead>سعر الوحدة</TableHead>
              <TableHead>الإجمالي</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sectionRows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-2">لا توجد بنود — اضغط إضافة سطر</TableCell></TableRow>
            ) : sectionRows.map(l => (
              <TableRow key={l.tmp}>
                <TableCell className="min-w-[200px]">
                  <Select value={l.item_id} onValueChange={v => update(l.tmp, { item_id: v })}>
                    <SelectTrigger><SelectValue placeholder="اختر صنف" /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {candidates.map(c => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="text-xs text-muted-foreground ml-2">[{KIND_LABEL[c.kind]}]</span>{c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="w-16 text-xs">{l.unit || "—"}</TableCell>
                <TableCell className="w-24">
                  <Input type="number" min={0} value={l.quantity || ""} onChange={e => update(l.tmp, { quantity: Number(e.target.value) })} />
                </TableCell>
                <TableCell className="w-24">
                  <Input type="number" min={0} value={l.unit_cost || ""} onChange={e => update(l.tmp, { unit_cost: Number(e.target.value) })} />
                </TableCell>
                <TableCell className="text-xs">{fmt(l.line_total)}</TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" onClick={() => setRows(rs => rs.filter(x => x.tmp !== l.tmp))}>
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Button size="sm" variant="outline" onClick={() => setRows(rs => [...rs, newLine(defaultKind)])}>
          <Plus className="w-4 h-4 ml-1" /> إضافة سطر {title}
        </Button>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-amber-800 dark:text-amber-200">
        أدخل البنود الفعلية للفاتورة. سيتم إعادة احتساب الإجماليات تلقائيًا.
      </div>
      {renderSection("مواد خام وبهارات", ["raw", "spice"], rawCandidates, "raw")}
      {renderSection("خامات التغليف", ["packaging"], packCandidates, "packaging")}
      <div className="flex items-center justify-between flex-wrap gap-2 border-t pt-2">
        <div className="text-xs">
          خامات: <b>{fmt(totals.raw)}</b> | بهارات: <b>{fmt(totals.spice)}</b> | تغليف: <b>{fmt(totals.pack)}</b> | الإجمالي: <b className="text-purple-700">{fmt(totals.all)}</b>
        </div>
        <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700">
          {saving ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 ml-1" />}
          حفظ البنود
        </Button>
      </div>
    </div>
  );
}
