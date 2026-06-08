import { useMemo, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldCheck, Sparkles, Send, Download, Lock, Info, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cairoTodayStartUTC, currentCairoYearMonth, cairoMonthStartUTC } from "@/lib/cairoDate";
import { exportCSV } from "@/lib/csvExport";
import { toast } from "@/hooks/use-toast";

type ModuleKey = "farm" | "hatchery" | "sales" | "orders" | "customers" | "private_courier";

type AnswerRow = Record<string, string | number>;

interface AnswerResult {
  title: string;
  summary?: string;
  rows: AnswerRow[];
  note?: string;
}

interface QuickQuestion {
  id: string;
  module: ModuleKey;
  label: string;
  /** Required role keys — empty = any signed-in user can ask */
  requireRoles?: string[];
  run: (ctx: RunContext) => Promise<AnswerResult>;
}

interface RunContext {
  fromDate: Date;
  toDate: Date;
}

const MODULE_LABELS: Record<ModuleKey, string> = {
  farm: "مزرعة الأمهات",
  hatchery: "معمل التفريخ",
  sales: "التسويق والمبيعات",
  orders: "الطلبات",
  customers: "العملاء",
  private_courier: "المندوب الخاص",
};

// ------------------------- helpers -------------------------

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function topN<T>(arr: T[], k: number): T[] {
  return arr.slice(0, k);
}

// ------------------------- predefined queries -------------------------

const QUESTIONS: QuickQuestion[] = [
  // ----- مزرعة الأمهات -----
  {
    id: "farm_today",
    module: "farm",
    label: "إنتاج البيض اليوم كام؟",
    async run() {
      const start = cairoTodayStartUTC();
      const { data, error } = await supabase
        .from("farm_egg_production")
        .select("egg_count, production_date")
        .gte("production_date", isoDate(start));
      if (error) throw error;
      const total = (data || []).reduce((s, r: any) => s + n(r.egg_count), 0);
      return {
        title: "إنتاج البيض اليوم",
        summary: `إجمالي البيض المسجل اليوم: ${total.toLocaleString("ar-EG")} بيضة`,
        rows: [{ "البيان": "اليوم", "عدد البيض": total }],
      };
    },
  },
  {
    id: "farm_week",
    module: "farm",
    label: "إنتاج البيض هذا الأسبوع؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const { data, error } = await supabase
        .from("farm_egg_production")
        .select("egg_count, production_date")
        .gte("production_date", isoDate(start));
      if (error) throw error;
      const total = (data || []).reduce((s, r: any) => s + n(r.egg_count), 0);
      const byDay = new Map<string, number>();
      (data || []).forEach((r: any) => {
        byDay.set(r.production_date, (byDay.get(r.production_date) || 0) + n(r.egg_count));
      });
      const rows = Array.from(byDay.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([d, c]) => ({ "اليوم": d, "عدد البيض": c }));
      return {
        title: "إنتاج البيض خلال آخر 7 أيام",
        summary: `إجمالي: ${total.toLocaleString("ar-EG")} بيضة`,
        rows,
      };
    },
  },
  {
    id: "farm_top_families",
    module: "farm",
    label: "مقارنة إنتاج الأسر هذا الشهر (أعلى/أقل)؟",
    async run() {
      const { year, monthIndex0 } = currentCairoYearMonth();
      const start = cairoMonthStartUTC(year, monthIndex0);
      const { data, error } = await supabase
        .from("farm_egg_production")
        .select("egg_count, family_id, farm_families(family_number)")
        .gte("production_date", isoDate(start));
      if (error) throw error;
      const byFam = new Map<string, { name: string; total: number }>();
      (data || []).forEach((r: any) => {
        const key = r.family_id || "—";
        const name = r.farm_families?.family_number || "غير محدد";
        const cur = byFam.get(key) || { name, total: 0 };
        cur.total += n(r.egg_count);
        byFam.set(key, cur);
      });
      const sorted = Array.from(byFam.values()).sort((a, b) => b.total - a.total);
      const rows = sorted.map((f, i) => ({
        "الترتيب": i + 1,
        "الأسرة": f.name,
        "إنتاج الشهر": f.total,
      }));
      const top = sorted[0];
      const bottom = sorted[sorted.length - 1];
      return {
        title: "ترتيب إنتاج الأسر هذا الشهر",
        summary: top
          ? `الأعلى: أسرة ${top.name} (${top.total.toLocaleString("ar-EG")}) — الأقل: أسرة ${
              bottom?.name
            } (${bottom?.total.toLocaleString("ar-EG")})`
          : "لا توجد بيانات",
        rows,
      };
    },
  },
  {
    id: "farm_shipped",
    module: "farm",
    label: "البيض المرحل للمعمل؟ (آخر 30 يوم)",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const { data, error } = await supabase
        .from("farm_to_hatchery_shipments")
        .select("egg_count, received_egg_count, status, production_date")
        .gte("production_date", isoDate(start));
      if (error) throw error;
      const totalShipped = (data || []).reduce((s, r: any) => s + n(r.egg_count), 0);
      const totalReceived = (data || []).reduce((s, r: any) => s + n(r.received_egg_count), 0);
      return {
        title: "البيض المرحل للمعمل (آخر 30 يوم)",
        summary: `مرسل: ${totalShipped.toLocaleString("ar-EG")} — مستلم بالمعمل: ${totalReceived.toLocaleString(
          "ar-EG",
        )}`,
        rows: [
          { "البيان": "إجمالي المُرسل", "العدد": totalShipped },
          { "البيان": "إجمالي المُستلم", "العدد": totalReceived },
          { "البيان": "فرق", "العدد": totalShipped - totalReceived },
        ],
      };
    },
  },

  // ----- معمل التفريخ -----
  {
    id: "hatch_open",
    module: "hatchery",
    label: "الدفعات المفتوحة حاليًا؟",
    async run() {
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("batch_number, receive_date, machine, received_eggs, net_eggs, exit_date")
        .is("exit_date", null)
        .order("receive_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        "رقم الدفعة": r.batch_number,
        "تاريخ الاستلام": r.receive_date,
        "الماكينة": r.machine || "—",
        "بيض مستلم": n(r.received_eggs),
        "صافي البيض": n(r.net_eggs),
      }));
      return {
        title: "الدفعات المفتوحة حاليًا",
        summary: `عدد الدفعات المفتوحة: ${rows.length}`,
        rows,
      };
    },
  },
  {
    id: "hatch_intake_30d",
    module: "hatchery",
    label: "عدد البيض الداخل للمعمل (آخر 30 يوم)؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("received_eggs, net_eggs, receive_date")
        .gte("receive_date", isoDate(start));
      if (error) throw error;
      const totalReceived = (data || []).reduce((s, r: any) => s + n(r.received_eggs), 0);
      const totalNet = (data || []).reduce((s, r: any) => s + n(r.net_eggs), 0);
      return {
        title: "بيض داخل للمعمل (آخر 30 يوم)",
        summary: `مستلم: ${totalReceived.toLocaleString("ar-EG")} — صافي: ${totalNet.toLocaleString("ar-EG")}`,
        rows: [
          { "البيان": "إجمالي المستلم", "العدد": totalReceived },
          { "البيان": "صافي البيض", "العدد": totalNet },
        ],
      };
    },
  },
  {
    id: "hatch_results",
    module: "hatchery",
    label: "نسب الفقس (الدفعات المغلقة آخر 60 يوم)؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 60);
      const { data, error } = await supabase
        .from("hatch_batches")
        .select("batch_number, net_eggs, hatched_chicks, exit_date")
        .not("exit_date", "is", null)
        .gte("exit_date", isoDate(start))
        .order("exit_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = (data || []).map((r: any) => {
        const net = n(r.net_eggs);
        const ch = n(r.hatched_chicks);
        const rate = net > 0 ? ((ch / net) * 100).toFixed(1) + "%" : "—";
        return {
          "الدفعة": r.batch_number,
          "تاريخ الفقس": r.exit_date,
          "صافي البيض": net,
          "الكتاكيت": ch,
          "النسبة": rate,
        };
      });
      const totalNet = (data || []).reduce((s, r: any) => s + n(r.net_eggs), 0);
      const totalCh = (data || []).reduce((s, r: any) => s + n(r.hatched_chicks), 0);
      const avg = totalNet > 0 ? ((totalCh / totalNet) * 100).toFixed(1) : "—";
      return {
        title: "نسب الفقس (آخر 60 يوم)",
        summary: `متوسط الفقس: ${avg}% — إجمالي كتاكيت: ${totalCh.toLocaleString("ar-EG")}`,
        rows,
      };
    },
  },
  {
    id: "hatch_debts",
    module: "hatchery",
    label: "مديونيات عملاء المعمل؟",
    async run() {
      const { data, error } = await (supabase as any)
        .from("v_hatchery_client_balances")
        .select("client_name, total_amount, paid_amount, remaining_amount")
        .gt("remaining_amount", 0)
        .order("remaining_amount", { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        "العميل": r.client_name || "—",
        "إجمالي الفواتير": Number(n(r.total_amount).toFixed(2)),
        "المدفوع": Number(n(r.paid_amount).toFixed(2)),
        "المديونية": Number(n(r.remaining_amount).toFixed(2)),
      }));
      const total = rows.reduce((s, r) => s + n(r["المديونية"]), 0);
      return {
        title: "مديونيات عملاء معمل التفريخ",
        summary: `إجمالي المديونيات: ${total.toLocaleString("ar-EG")} ج.م — ${rows.length} عميل`,
        rows,
        note: "محسوبة من view: v_hatchery_client_balances (total_amount − paid_amount)",
      };
    },
  },

  // ----- التسويق والمبيعات -----
  {
    id: "sales_today",
    module: "sales",
    label: "مبيعات اليوم؟",
    async run() {
      const start = cairoTodayStartUTC();
      const { data, error } = await supabase
        .from("orders")
        .select("total, status")
        .gte("created_at", start.toISOString());
      if (error) throw error;
      const cancelled = (data || []).filter((r: any) => r.status === "cancelled");
      const valid = (data || []).filter((r: any) => r.status !== "cancelled");
      const total = valid.reduce((s, r: any) => s + n(r.total), 0);
      return {
        title: "مبيعات اليوم",
        summary: `${valid.length} طلب — إجمالي: ${total.toLocaleString("ar-EG")} ج.م (مستبعد ${cancelled.length} ملغي)`,
        rows: [
          { "البيان": "عدد الطلبات", "القيمة": valid.length },
          { "البيان": "إجمالي المبيعات", "القيمة": Number(total.toFixed(2)) },
          { "البيان": "الطلبات الملغاة", "القيمة": cancelled.length },
        ],
      };
    },
  },
  {
    id: "sales_week",
    module: "sales",
    label: "مبيعات هذا الأسبوع؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const { data, error } = await supabase
        .from("orders")
        .select("total, status, created_at")
        .gte("created_at", start.toISOString())
        .neq("status", "cancelled");
      if (error) throw error;
      const byDay = new Map<string, { count: number; total: number }>();
      (data || []).forEach((r: any) => {
        const d = String(r.created_at).slice(0, 10);
        const cur = byDay.get(d) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += n(r.total);
        byDay.set(d, cur);
      });
      const rows = Array.from(byDay.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([d, v]) => ({ "اليوم": d, "عدد الطلبات": v.count, "الإجمالي": Number(v.total.toFixed(2)) }));
      const total = (data || []).reduce((s, r: any) => s + n(r.total), 0);
      return {
        title: "مبيعات آخر 7 أيام",
        summary: `${data?.length || 0} طلب — إجمالي: ${total.toLocaleString("ar-EG")} ج.م`,
        rows,
      };
    },
  },
  {
    id: "sales_top_products",
    module: "sales",
    label: "أفضل المنتجات مبيعًا (آخر 30 يوم)؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const { data: orders, error: oerr } = await supabase
        .from("orders")
        .select("id")
        .gte("created_at", start.toISOString())
        .neq("status", "cancelled")
        .limit(1000);
      if (oerr) throw oerr;
      const ids = (orders || []).map((o: any) => o.id);
      if (ids.length === 0) return { title: "أفضل المنتجات", summary: "لا توجد بيانات", rows: [] };
      const { data, error } = await supabase
        .from("order_items")
        .select("product_name, quantity, total_price, order_id")
        .in("order_id", ids);
      if (error) throw error;
      const agg = new Map<string, { qty: number; total: number }>();
      (data || []).forEach((r: any) => {
        const cur = agg.get(r.product_name) || { qty: 0, total: 0 };
        cur.qty += n(r.quantity);
        cur.total += n(r.total_price);
        agg.set(r.product_name, cur);
      });
      const sorted = Array.from(agg.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([name, v]) => ({
          "المنتج": name,
          "الكمية": Number(v.qty.toFixed(2)),
          "الإجمالي": Number(v.total.toFixed(2)),
        }));
      return {
        title: "أفضل المنتجات مبيعًا (آخر 30 يوم)",
        summary: `أعلى ${Math.min(sorted.length, 20)} منتج`,
        rows: topN(sorted, 20),
      };
    },
  },
  {
    id: "sales_top_govs",
    module: "sales",
    label: "أفضل المحافظات (آخر 30 يوم)؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const { data, error } = await supabase
        .from("orders")
        .select("total, customers(governorate)")
        .gte("created_at", start.toISOString())
        .neq("status", "cancelled");
      if (error) throw error;
      const agg = new Map<string, { count: number; total: number }>();
      (data || []).forEach((r: any) => {
        const g = r.customers?.governorate || "غير محدد";
        const cur = agg.get(g) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += n(r.total);
        agg.set(g, cur);
      });
      const rows = Array.from(agg.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([g, v]) => ({
          "المحافظة": g,
          "عدد الطلبات": v.count,
          "الإجمالي": Number(v.total.toFixed(2)),
        }));
      return {
        title: "أفضل المحافظات (آخر 30 يوم)",
        summary: `${rows.length} محافظة`,
        rows,
      };
    },
  },
  {
    id: "sales_top_moderators",
    module: "sales",
    label: "أفضل المودريتورز (آخر 30 يوم)؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const { data, error } = await supabase
        .from("orders")
        .select("total, moderator")
        .gte("created_at", start.toISOString())
        .neq("status", "cancelled");
      if (error) throw error;
      const agg = new Map<string, { count: number; total: number }>();
      (data || []).forEach((r: any) => {
        const m = r.moderator || "غير محدد";
        const cur = agg.get(m) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += n(r.total);
        agg.set(m, cur);
      });
      const rows = Array.from(agg.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([m, v]) => ({
          "المودريتور": m,
          "عدد الطلبات": v.count,
          "الإجمالي": Number(v.total.toFixed(2)),
        }));
      return { title: "أداء المودريتورز (آخر 30 يوم)", summary: `${rows.length} مودريتور`, rows };
    },
  },

  // ----- الطلبات -----
  {
    id: "orders_pending",
    module: "orders",
    label: "الطلبات قيد الانتظار؟",
    async run() {
      const { data, error } = await supabase
        .from("orders")
        .select("order_number, status, total, created_at, customers(name)")
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        "رقم الطلب": r.order_number,
        "العميل": r.customers?.name || "—",
        "الحالة": r.status,
        "الإجمالي": Number(n(r.total).toFixed(2)),
        "تاريخ الإنشاء": String(r.created_at).slice(0, 16).replace("T", " "),
      }));
      return { title: "طلبات قيد الانتظار", summary: `${rows.length} طلب`, rows };
    },
  },
  {
    id: "orders_delayed",
    module: "orders",
    label: "الطلبات المتأخرة (أقدم من 3 أيام وقيد الانتظار)؟",
    async run() {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 3);
      const { data, error } = await supabase
        .from("orders")
        .select("order_number, status, total, created_at, customers(name, governorate)")
        .in("status", ["pending", "processing"])
        .lt("created_at", cutoff.toISOString())
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        "رقم الطلب": r.order_number,
        "العميل": r.customers?.name || "—",
        "المحافظة": r.customers?.governorate || "—",
        "الحالة": r.status,
        "تاريخ الإنشاء": String(r.created_at).slice(0, 10),
      }));
      return { title: "طلبات متأخرة (>3 أيام)", summary: `${rows.length} طلب متأخر`, rows };
    },
  },
  {
    id: "orders_by_shipping",
    module: "orders",
    label: "المبيعات حسب طريقة التوصيل (آخر 30 يوم)؟",
    async run() {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const { data, error } = await supabase
        .from("orders")
        .select("total, shipping_company, fulfillment_type")
        .gte("created_at", start.toISOString())
        .neq("status", "cancelled");
      if (error) throw error;
      const agg = new Map<string, { count: number; total: number }>();
      (data || []).forEach((r: any) => {
        const key = r.shipping_company || r.fulfillment_type || "غير محدد";
        const cur = agg.get(key) || { count: 0, total: 0 };
        cur.count += 1;
        cur.total += n(r.total);
        agg.set(key, cur);
      });
      const rows = Array.from(agg.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([k, v]) => ({
          "طريقة التوصيل": k,
          "عدد الطلبات": v.count,
          "الإجمالي": Number(v.total.toFixed(2)),
        }));
      return { title: "المبيعات حسب طريقة التوصيل", summary: `${rows.length} طريقة`, rows };
    },
  },

  // ----- العملاء -----
  {
    id: "top_customers",
    module: "customers",
    label: "العملاء الأكثر شراءً؟",
    async run() {
      const { data, error } = await supabase
        .from("customers")
        .select("name, governorate, total_orders, total_spent")
        .order("total_spent", { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        "العميل": r.name,
        "المحافظة": r.governorate || "—",
        "عدد الطلبات": n(r.total_orders),
        "إجمالي المشتريات": Number(n(r.total_spent).toFixed(2)),
      }));
      return { title: "أعلى 50 عميل", summary: `${rows.length} عميل`, rows };
    },
  },

  // ----- المندوب الخاص -----
  {
    id: "pc_open",
    module: "private_courier",
    label: "طلبات المندوب الخاص المفتوحة؟",
    async run() {
      const { data, error } = await supabase
        .from("orders")
        .select("order_number, status, total, customers(name, governorate)")
        .eq("fulfillment_type", "private_courier")
        .in("status", ["pending", "processing", "out_for_delivery"])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data || []).map((r: any) => ({
        "رقم الطلب": r.order_number,
        "العميل": r.customers?.name || "—",
        "المحافظة": r.customers?.governorate || "—",
        "الحالة": r.status,
        "الإجمالي": Number(n(r.total).toFixed(2)),
      }));
      return { title: "طلبات المندوب الخاص المفتوحة", summary: `${rows.length} طلب`, rows };
    },
  },
  {
    id: "pc_expected_collection",
    module: "private_courier",
    label: "إجمالي التحصيل المتوقع للمندوب الخاص؟",
    async run() {
      const { data, error } = await supabase
        .from("pc_collections")
        .select("amount_due, amount_collected, status")
        .in("status", ["not_collected", "partial_collected", "mismatch"]);
      if (error) throw error;
      const due = (data || []).reduce((s, r: any) => s + n(r.amount_due), 0);
      const collected = (data || []).reduce((s, r: any) => s + n(r.amount_collected), 0);
      return {
        title: "تحصيل المندوب الخاص (المعلق)",
        summary: `المستحق: ${due.toLocaleString("ar-EG")} — تم تحصيله: ${collected.toLocaleString("ar-EG")} — متبقي: ${(
          due - collected
        ).toLocaleString("ar-EG")}`,
        rows: [
          { "البيان": "إجمالي المستحق", "القيمة": Number(due.toFixed(2)) },
          { "البيان": "تم تحصيله", "القيمة": Number(collected.toFixed(2)) },
          { "البيان": "متبقي", "القيمة": Number((due - collected).toFixed(2)) },
        ],
      };
    },
  },
];

// ------------------------- module visibility per role -------------------------

function visibleModulesForUser(roles: string[]): Set<ModuleKey> {
  const set = new Set<ModuleKey>();
  const has = (r: string) => roles.includes(r);
  if (has("general_manager") || has("executive_manager")) {
    return new Set(Object.keys(MODULE_LABELS) as ModuleKey[]);
  }
  if (has("sales_manager") || has("marketing_sales_manager") || has("sales_moderator")) {
    set.add("sales");
    set.add("orders");
    set.add("customers");
    set.add("private_courier");
  }
  if (has("hatchery_manager")) set.add("hatchery");
  if (has("farm_manager")) set.add("farm");
  if (has("production_manager")) {
    set.add("farm");
    set.add("hatchery");
  }
  if (has("accountant") || has("financial_manager")) {
    set.add("sales");
    set.add("orders");
    set.add("hatchery");
    set.add("private_courier");
  }
  if (has("private_delivery_rep")) set.add("private_courier");
  return set;
}

// ------------------------- component -------------------------

export default function AiOperationsAssistant() {
  const { user, roles, isGeneralManager, isExecutiveManager } = useAuth();
  const canUseAiChat = isGeneralManager || isExecutiveManager;
  const allowedModules = useMemo(() => visibleModulesForUser(roles as string[]), [roles]);
  const [moduleFilter, setModuleFilter] = useState<ModuleKey | "all">("all");
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const [fromDate, setFromDate] = useState<string>(isoDate(monthAgo));
  const [toDate, setToDate] = useState<string>(isoDate(today));
  const [freeText, setFreeText] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<AnswerResult | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<string>("");

  // ----- Phase 2 (managers only): free-text AI question state -----
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAnswer, setAiAnswer] = useState<string>("");
  const [aiUsage, setAiUsage] = useState<{ used_today: number; remaining: number; per_user_daily: number } | null>(null);
  const [aiError, setAiError] = useState<string>("");


  const visibleQuestions = useMemo(
    () =>
      QUESTIONS.filter((q) => allowedModules.has(q.module)).filter((q) =>
        moduleFilter === "all" ? true : q.module === moduleFilter,
      ),
    [allowedModules, moduleFilter],
  );

  async function logQuery(question: string, module: string | null) {
    if (!user) return;
    try {
      await (supabase as any).from("ai_assistant_query_log").insert({
        user_id: user.id,
        question,
        module,
        date_from: fromDate || null,
        date_to: toDate || null,
      });
    } catch {
      /* non-blocking */
    }
  }

  async function runQuestion(q: QuickQuestion) {
    setLoading(true);
    setAnswer(null);
    setCurrentQuestion(q.label);
    try {
      const ctx: RunContext = {
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
      };
      const result = await q.run(ctx);
      setAnswer(result);
      await logQuery(q.label, q.module);
    } catch (e: any) {
      toast({
        title: "تعذّر تنفيذ الاستعلام",
        description: e?.message || "حدث خطأ. قد يكون لديك صلاحيات محدودة لهذا التقرير.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function submitFreeText() {
    const text = freeText.trim();
    if (!text) return;
    // Try fuzzy match by label substring
    const match = visibleQuestions.find(
      (q) =>
        q.label.includes(text) ||
        text.split(/\s+/).every((w) => q.label.includes(w)),
    );
    if (match) {
      runQuestion(match);
    } else {
      logQuery(text, null);
      setCurrentQuestion(text);
      setAnswer({
        title: "لم أتعرّف على هذا السؤال في وضع القراءة فقط",
        summary:
          "هذه المرحلة (1) تدعم الأسئلة المُعرَّفة مسبقًا فقط. اختر سؤالًا من القائمة بالأسفل أو من الأسئلة السريعة.",
        rows: [],
      });
    }
  }

  function exportAnswer() {
    if (!answer || answer.rows.length === 0) {
      toast({ title: "لا توجد بيانات للتصدير", variant: "destructive" });
      return;
    }
    const filename = `ai-assistant-${Date.now()}.csv`;
    exportCSV(filename, answer.rows as any);
  }

  async function askAi() {
    const q = aiQuestion.trim();
    if (!q) return;
    setAiLoading(true);
    setAiAnswer("");
    setAiError("");
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant-chat", {
        body: {
          question: q,
          module: moduleFilter === "all" ? "all" : moduleFilter,
          date_from: fromDate,
          date_to: toDate,
        },
      });
      if (error) {
        const msg = (error as any)?.context?.body
          ? (() => {
              try { return JSON.parse((error as any).context.body)?.error; } catch { return null; }
            })()
          : null;
        setAiError(msg || error.message || "تعذّر الاتصال بالمساعد الذكي.");
        return;
      }
      if (data?.error) {
        setAiError(data.error);
        if (typeof data.remaining === "number") {
          setAiUsage({ used_today: PER_USER_DAILY_UI - data.remaining, remaining: data.remaining, per_user_daily: PER_USER_DAILY_UI });
        }
        return;
      }
      setAiAnswer(String(data?.answer || ""));
      if (data?.usage) setAiUsage(data.usage);
    } catch (e: any) {
      setAiError(e?.message || "خطأ غير متوقع.");
    } finally {
      setAiLoading(false);
    }
  }


  return (
    <DashboardLayout>
      <div dir="rtl" className="space-y-6 p-2 md:p-4">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">المساعد الذكي للتشغيل والإدارة</h1>
              <p className="text-sm text-muted-foreground">
                ملخصات تشغيلية فورية لمزرعة الأمهات، معمل التفريخ، المبيعات، الطلبات، العملاء والمندوب الخاص.
              </p>
            </div>
          </div>

          <Alert className="border-primary/30 bg-primary/5">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <AlertDescription className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline" className="gap-1">
                <Lock className="h-3 w-3" /> وضع القراءة فقط
              </Badge>
              المساعد يقرأ ويحلل فقط ولا يقوم بأي تعديل أو إضافة أو حذف للبيانات، ويلتزم بصلاحياتك (RLS) لا يتجاوزها.
            </AlertDescription>
          </Alert>
        </div>

        {/* Filters + question composer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">اسأل المساعد</CardTitle>
            <CardDescription>اختر سؤالًا جاهزًا أو اكتب جزءًا من نصه ليطابقه المساعد.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">من تاريخ</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">إلى تاريخ</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs text-muted-foreground">الموديول</label>
                <Select value={moduleFilter} onValueChange={(v) => setModuleFilter(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الموديولات المتاحة</SelectItem>
                    {Array.from(allowedModules).map((m) => (
                      <SelectItem key={m} value={m}>
                        {MODULE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2 md:flex-row">
              <Textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                rows={2}
                placeholder="مثال: مبيعات اليوم؟ أو إنتاج البيض هذا الأسبوع؟"
                className="flex-1"
              />
              <Button onClick={submitFreeText} disabled={loading} className="md:w-32">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                إرسال
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Quick questions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">أسئلة سريعة</CardTitle>
            <CardDescription>
              تُعرض حسب صلاحياتك فقط. متاح لك حاليًا {visibleQuestions.length} سؤال.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {visibleQuestions.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                لا توجد أسئلة متاحة لدورك الحالي.
              </div>
            ) : (
              <Tabs value={moduleFilter} onValueChange={(v) => setModuleFilter(v as any)}>
                <TabsList className="mb-3 flex flex-wrap gap-1">
                  <TabsTrigger value="all">الكل</TabsTrigger>
                  {Array.from(allowedModules).map((m) => (
                    <TabsTrigger key={m} value={m}>
                      {MODULE_LABELS[m]}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleQuestions.map((q) => (
                    <Button
                      key={q.id}
                      variant="outline"
                      className="h-auto justify-start whitespace-normal py-3 text-right"
                      onClick={() => runQuestion(q)}
                      disabled={loading}
                    >
                      <div className="flex w-full flex-col items-start gap-1">
                        <span className="text-xs text-muted-foreground">{MODULE_LABELS[q.module]}</span>
                        <span className="text-sm font-medium">{q.label}</span>
                      </div>
                    </Button>
                  ))}
                </div>
              </Tabs>
            )}
          </CardContent>
        </Card>

        {/* Answer */}
        {(loading || answer) && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{answer?.title || "جارٍ التحضير..."}</CardTitle>
                  {currentQuestion && (
                    <CardDescription className="mt-1">السؤال: {currentQuestion}</CardDescription>
                  )}
                </div>
                {answer && answer.rows.length > 0 && (
                  <Button variant="outline" size="sm" onClick={exportAnswer}>
                    <Download className="h-4 w-4" /> تصدير CSV
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> جارٍ قراءة البيانات...
                </div>
              ) : answer ? (
                <div className="space-y-3">
                  {answer.summary && (
                    <div className="rounded-md bg-muted/40 p-3 text-sm font-medium">{answer.summary}</div>
                  )}
                  {answer.rows.length > 0 ? (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(answer.rows[0]).map((h) => (
                              <TableHead key={h} className="text-right">
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {answer.rows.map((r, i) => (
                            <TableRow key={i}>
                              {Object.keys(answer.rows[0]).map((h) => (
                                <TableCell key={h} className="text-right">
                                  {typeof r[h] === "number"
                                    ? Number(r[h]).toLocaleString("ar-EG")
                                    : String(r[h] ?? "—")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">لا توجد بيانات لعرضها.</div>
                  )}
                  {answer.note && (
                    <Alert>
                      <Info className="h-4 w-4" />
                      <AlertDescription className="text-xs">{answer.note}</AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
