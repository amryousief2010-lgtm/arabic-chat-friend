import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FileDown, Printer, FileSpreadsheet, Megaphone, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { openPrintWindow, escapeHtml, fmtNum, fmtDate, COMPANY_AR } from "@/lib/printPdf";
import { toast } from "sonner";
import {
  aggregateByArea, aggregateBySource, aggregateProducts, classifySource,
  computeKPIs, dailySeries, detectNewCustomers, fetchExpensesInRange,
  fetchOrderItemsForOrders, fetchOrdersInRange, isCancelledOrder, isGiftOrder,
  last3MonthsRange, UNSPECIFIED, type DateRange, type ExpenseRow, type OrderLite, type OrderItemLite,
} from "@/lib/socialMediaAnalytics";

const toISOFrom = (d: string) => new Date(d + "T00:00:00").toISOString();
const toISOTo = (d: string) => new Date(d + "T23:59:59").toISOString();

export default function SocialMediaExport() {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const isManager =
    isGeneralManager ||
    isExecutiveManager ||
    (roles || []).includes("marketing_sales_manager");

  // Default: last 3 months
  const initial = last3MonthsRange();
  const [from, setFrom] = useState(initial.from.slice(0, 10));
  const [to, setTo] = useState(initial.to.slice(0, 10));

  // Filters
  const [sourceFilter, setSourceFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [governorateFilter, setGovernorateFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [campaignFilter, setCampaignFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [expenseTypeFilter, setExpenseTypeFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");

  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [items, setItems] = useState<OrderItemLite[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [dailyReports, setDailyReports] = useState<any[]>([]);
  const [weeklyReports, setWeeklyReports] = useState<any[]>([]);
  const [newCustIds, setNewCustIds] = useState<Set<string>>(new Set());

  const range: DateRange = useMemo(
    () => ({ from: toISOFrom(from), to: toISOTo(to) }),
    [from, to],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isManager) return;
      setLoading(true);
      try {
        const [ords, exps] = await Promise.all([
          fetchOrdersInRange(range),
          fetchExpensesInRange(range),
        ]);
        if (cancelled) return;
        const custIds = Array.from(
          new Set(ords.map((o) => o.customer_id).filter(Boolean) as string[]),
        );
        const [orderItems, newCust, dailyR, weeklyR] = await Promise.all([
          fetchOrderItemsForOrders(ords.map((o) => o.id)),
          detectNewCustomers(custIds, range),
          supabase
            .from("social_media_daily_reports")
            .select("*")
            .gte("report_date", from)
            .lte("report_date", to)
            .order("report_date", { ascending: true }),
          supabase
            .from("social_media_weekly_reports")
            .select("*")
            .gte("week_start_date", from)
            .lte("week_end_date", to)
            .order("week_start_date", { ascending: true }),
        ]);
        if (cancelled) return;
        setOrders(ords);
        setItems(orderItems);
        setExpenses(exps);
        setNewCustIds(newCust);
        setDailyReports((dailyR.data as any) || []);
        setWeeklyReports((weeklyR.data as any) || []);
      } catch (e: any) {
        toast.error("خطأ في تحميل البيانات: " + (e?.message || String(e)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, isManager]);

  // Unique lists for filters
  const uniqueSources = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_source || o.source || UNSPECIFIED).trim()))),
    [orders],
  );
  const uniqueChannels = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_channel || UNSPECIFIED).trim()))),
    [orders],
  );
  const uniqueGovernorates = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_governorate || UNSPECIFIED).trim()))),
    [orders],
  );
  const uniqueAreas = useMemo(
    () => Array.from(new Set(orders.map((o) => (o.customer_area || UNSPECIFIED).trim()))),
    [orders],
  );
  const uniqueCampaigns = useMemo(
    () => Array.from(new Set(orders.map((o: any) => (o.customer_campaign || UNSPECIFIED).trim()))),
    [orders],
  );
  const uniqueStatuses = useMemo(() => Array.from(new Set(orders.map((o) => o.status))), [orders]);
  const uniqueProducts = useMemo(
    () => Array.from(new Set(items.map((i) => i.product_name))).sort(),
    [items],
  );
  const uniqueExpenseTypes = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.expense_type))).filter(Boolean),
    [expenses],
  );
  const uniquePlatforms = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.platform).filter(Boolean) as string[])),
    [expenses],
  );
  const uniqueEmployees = useMemo(() => {
    const s = new Set<string>();
    expenses.forEach((e) => e.employee_name && s.add(e.employee_name));
    dailyReports.forEach((r: any) => r.employee_name && s.add(r.employee_name));
    return Array.from(s);
  }, [expenses, dailyReports]);

  // Apply filters
  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (sourceFilter !== "all" && (o.customer_source || o.source || UNSPECIFIED).trim() !== sourceFilter) return false;
      if (channelFilter !== "all" && (o.customer_channel || UNSPECIFIED).trim() !== channelFilter) return false;
      if (governorateFilter !== "all" && (o.customer_governorate || UNSPECIFIED).trim() !== governorateFilter) return false;
      if (areaFilter !== "all" && (o.customer_area || UNSPECIFIED).trim() !== areaFilter) return false;
      if (campaignFilter !== "all") {
        const c = ((o as any).customer_campaign || UNSPECIFIED).trim();
        if (c !== campaignFilter) return false;
      }
      return true;
    });
  }, [orders, statusFilter, sourceFilter, channelFilter, governorateFilter, areaFilter, campaignFilter]);

  const filteredOrderIds = useMemo(() => new Set(filteredOrders.map((o) => o.id)), [filteredOrders]);
  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (!filteredOrderIds.has(it.order_id)) return false;
      if (productFilter !== "all" && it.product_name !== productFilter) return false;
      return true;
    });
  }, [items, filteredOrderIds, productFilter]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (expenseTypeFilter !== "all" && e.expense_type !== expenseTypeFilter) return false;
      if (platformFilter !== "all" && (e.platform || "") !== platformFilter) return false;
      if (employeeFilter !== "all" && (e.employee_name || "") !== employeeFilter) return false;
      return true;
    });
  }, [expenses, expenseTypeFilter, platformFilter, employeeFilter]);

  const filteredDailyReports = useMemo(() => {
    return dailyReports.filter((r: any) => {
      if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
      return true;
    });
  }, [dailyReports, employeeFilter]);

  const filteredWeeklyReports = useMemo(() => {
    return weeklyReports.filter((r: any) => {
      if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
      return true;
    });
  }, [weeklyReports, employeeFilter]);

  const approvedExpense = useMemo(
    () => filteredExpenses.filter((e) => e.is_approved).reduce((s, e) => s + e.amount, 0),
    [filteredExpenses],
  );
  const pendingExpense = useMemo(
    () => filteredExpenses.filter((e) => !e.is_approved).reduce((s, e) => s + e.amount, 0),
    [filteredExpenses],
  );

  const kpis = useMemo(
    () => computeKPIs(filteredOrders, approvedExpense, pendingExpense, newCustIds),
    [filteredOrders, approvedExpense, pendingExpense, newCustIds],
  );

  const sourceAgg = useMemo(() => aggregateBySource(filteredOrders), [filteredOrders]);
  const areaAgg = useMemo(() => aggregateByArea(filteredOrders), [filteredOrders]);
  const ordersById = useMemo(() => new Map(filteredOrders.map((o) => [o.id, o])), [filteredOrders]);
  const productAgg = useMemo(() => aggregateProducts(filteredItems, ordersById), [filteredItems, ordersById]);

  const periodLabel = `${from} → ${to}`;

  const budgetStatusLabel = (): string => {
    switch (kpis.budgetStatus) {
      case "safe": return "آمن (≤ 5%)";
      case "warning": return "تحذير (> 5% و ≤ 6%)";
      case "danger": return "خطر (> 6%)";
      default: return "لا توجد مبيعات";
    }
  };

  const exportExcel = () => {
    if (filteredOrders.length === 0 && filteredExpenses.length === 0 && filteredDailyReports.length === 0) {
      toast.error("لا توجد بيانات في النطاق المحدد");
      return;
    }
    const wb = XLSX.utils.book_new();

    // 1. Summary
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["تقرير التسويق والمبيعات — نعام العاصمة"],
        ["الفترة", periodLabel],
        ["تاريخ الإصدار", new Date().toLocaleString("ar-EG")],
        [],
        ["إجمالي الطلبات", kpis.totalOrders],
        ["قيمة الطلبات (بدون الملغي/المجاني)", kpis.totalOrdersValue],
        ["المبيعات المنفذة (Delivered)", kpis.deliveredValue],
        ["عدد الأوردرات المنفذة", kpis.deliveredOrders],
        ["متوسط قيمة الأوردر", Math.round(kpis.avgOrderValue)],
        ["عملاء جدد", kpis.newCustomers],
        ["عملاء متكررون", kpis.repeatCustomers],
        ["طلبات مجانية", kpis.giftOrders],
        ["قيمة الطلبات المجانية (Original)", kpis.giftOriginalValue],
        ["طلبات ملغاة", kpis.cancelledOrders],
        ["أعلى مصدر عملاء", kpis.topSource?.key || "—"],
        ["قيمة أعلى مصدر", kpis.topSource?.value || 0],
        ["أعلى منطقة", kpis.topArea?.key || "—"],
        ["قيمة أعلى منطقة", kpis.topArea?.value || 0],
        [],
        ["إجمالي مصروفات السوشيال المعتمدة", kpis.approvedExpenses],
        ["مصروفات قيد المراجعة", kpis.pendingExpenses],
        ["نسبة مصروفات السوشيال %", kpis.actualRatio == null ? "—" : Number(kpis.actualRatio.toFixed(2))],
        ["حد 5%", Math.round(kpis.cost5pct)],
        ["حد 6%", Math.round(kpis.cost6pct)],
        ["الحالة", budgetStatusLabel()],
      ]),
      "Summary",
    );

    // 2. Orders
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        filteredOrders.map((o: any) => ({
          "رقم الأوردر": o.order_number,
          "تاريخ الأوردر": new Date(o.created_at).toLocaleString("ar-EG"),
          "اسم العميل": o.customer_name || "—",
          "المحافظة": o.customer_governorate || UNSPECIFIED,
          "المنطقة": o.customer_area || UNSPECIFIED,
          "مصدر العميل": (o.customer_source || o.source) || UNSPECIFIED,
          "قناة التواصل": o.customer_channel || UNSPECIFIED,
          "اسم الحملة": o.customer_campaign || UNSPECIFIED,
          "حالة الطلب": o.status,
          "طريقة التحصيل": o.collection_method || "—",
          "هل مجاني؟": isGiftOrder(o) ? "نعم" : "لا",
          "قيمة الأوردر": o.total,
        })),
      ),
      "Orders",
    );

    // 3. Sales By Source
    const totalRev = filteredOrders
      .filter((o) => !isCancelledOrder(o) && !isGiftOrder(o))
      .reduce((s, o) => s + o.total, 0);
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        sourceAgg.map((r) => {
          const customers = new Set(
            filteredOrders
              .filter((o) => !isCancelledOrder(o) && !isGiftOrder(o))
              .filter((o) => classifySource(o.customer_source || o.source).label === r.label)
              .map((o) => o.customer_id)
              .filter(Boolean),
          ).size;
          return {
            "مصدر العميل": r.label,
            "عدد الطلبات": r.orders,
            "إجمالي المبيعات": Math.round(r.revenue),
            "متوسط قيمة الأوردر": Math.round(r.avg),
            "عدد العملاء": customers,
            "نسبة من إجمالي المبيعات %": totalRev > 0 ? Number(((r.revenue / totalRev) * 100).toFixed(2)) : 0,
          };
        }),
      ),
      "Sales By Source",
    );

    // 4. Sales By Area
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        areaAgg.map((r) => ({
          "المحافظة / المنطقة": r.area,
          "عدد الطلبات": r.orders,
          "إجمالي المبيعات": Math.round(r.revenue),
          "متوسط قيمة الأوردر": Math.round(r.avg),
          "أكثر مصدر عملاء": r.topSource,
        })),
      ),
      "Sales By Area",
    );

    // 5. Product Performance
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        productAgg.map((r) => ({
          "المنتج": r.name,
          "الكمية المباعة": r.qty,
          "إجمالي المبيعات": Math.round(r.revenue),
          "عدد الطلبات": r.ordersCount,
          "متوسط سعر البيع": Math.round(r.avgPrice),
          "أعلى مصدر عميل": r.topSource,
        })),
      ),
      "Product Performance",
    );

    // 6. Approved Social Expenses
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        filteredExpenses
          .filter((e) => e.is_approved)
          .map((e) => ({
            "التاريخ": e.expense_date,
            "نوع المصروف": e.expense_type,
            "المنصة": e.platform || "—",
            "اسم الحملة": e.campaign_name || "—",
            "الموظف": e.employee_name || "—",
            "القيمة": e.amount,
            "الملاحظات": e.notes || "",
            "تاريخ الاعتماد": e.approved_at ? new Date(e.approved_at).toLocaleString("ar-EG") : "—",
            "المعتمد بواسطة": e.approved_by || "—",
          })),
      ),
      "Approved Social Expenses",
    );

    // 7. Pending Social Expenses
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        filteredExpenses
          .filter((e) => !e.is_approved)
          .map((e) => ({
            "التاريخ": e.expense_date,
            "نوع المصروف": e.expense_type,
            "المنصة": e.platform || "—",
            "اسم الحملة": e.campaign_name || "—",
            "الموظف": e.employee_name || "—",
            "القيمة": e.amount,
            "الملاحظات": e.notes || "",
            "منشئ المصروف": e.created_by || "—",
            "الحالة": "قيد المراجعة",
          })),
      ),
      "Pending Social Expenses",
    );

    // 8. Budget Ratio
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["البند", "القيمة"],
        ["إجمالي قيمة المبيعات", kpis.totalOrdersValue],
        ["إجمالي المصروفات المعتمدة", kpis.approvedExpenses],
        ["مصروفات قيد المراجعة", kpis.pendingExpenses],
        ["النسبة الرسمية %", kpis.actualRatio == null ? "—" : Number(kpis.actualRatio.toFixed(2))],
        ["حد 5%", Math.round(kpis.cost5pct)],
        ["حد 6%", Math.round(kpis.cost6pct)],
        ["المتبقي من حد 5%", Math.round(kpis.budgetRemaining5)],
        ["الفرق عن حد 6%", Math.round(kpis.budgetRemaining6)],
        ["الحالة", budgetStatusLabel()],
      ]),
      "Budget Ratio",
    );

    // 9. Daily Social Reports
    if (filteredDailyReports.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          filteredDailyReports.map((r: any) => ({
            "التاريخ": r.report_date,
            "الموظف": r.employee_name,
            "الحالة": r.status,
            "البوستات": r.posts_count,
            "الريلز/فيديو": r.reels_videos_count,
            "عملاء مهتمين": r.interested_customers_count,
            "الوصول": r.reach_count ?? "",
            "الظهور": r.impressions_count ?? "",
            "إعجابات": r.likes_count ?? "",
            "تعليقات": r.comments_count ?? "",
            "مشاركات": r.shares_count ?? "",
            "متابعون جدد": r.new_followers_count ?? "",
            "المنصات": Array.isArray(r.platforms) ? r.platforms.join(", ") : "",
            "اسم الحملة": r.campaign_name || "",
            "أعلى محتوى": r.top_engaging_content || "",
            "شكاوى": r.issues_or_complaints || "",
            "اقتراحات الغد": r.tomorrow_content_suggestions || "",
            "ملاحظات": r.additional_notes || "",
          })),
        ),
        "Daily Social Reports",
      );
    }

    // 10. Weekly Social Reports
    if (filteredWeeklyReports.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          filteredWeeklyReports.map((r: any) => ({
            "بداية الأسبوع": r.week_start_date,
            "نهاية الأسبوع": r.week_end_date,
            "الموظف": r.employee_name,
            "الحالة": r.status,
            "نمو فيسبوك": r.facebook_followers_growth,
            "نمو انستجرام": r.instagram_followers_growth,
            "نمو تيك توك": r.tiktok_followers_growth,
            "نمو يوتيوب": r.youtube_followers_growth,
            "عملاء محتملين": r.leads_count,
            "أفضل منصة": r.best_platform,
            "السبب": r.best_platform_reason,
            "مشاكل متكررة": r.repeated_problems || "",
            "الملخص": r.weekly_summary || "",
            "اقتراحات الأسبوع القادم": r.next_week_suggestions || "",
          })),
        ),
        "Weekly Social Reports",
      );
    }

    // 11. Complaints
    const complaints = filteredDailyReports.filter((r: any) => (r.issues_or_complaints || "").trim());
    if (complaints.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          complaints.map((r: any) => ({
            "التاريخ": r.report_date,
            "الموظف": r.employee_name,
            "العميل": r.related_customer_name || "—",
            "نص الشكوى": r.issues_or_complaints,
            "الحالة": r.complaint_status || "—",
            "المرفق": r.complaint_attachment_path || "",
          })),
        ),
        "Complaints",
      );
    }

    XLSX.writeFile(wb, `تقرير-التسويق-والمبيعات-${from}_الى_${to}.xlsx`);
    toast.success("تم تصدير الملف بنجاح");
  };

  const exportPDF = () => {
    if (filteredOrders.length === 0 && filteredExpenses.length === 0) {
      toast.error("لا توجد بيانات في النطاق المحدد");
      return;
    }
    const table = (title: string, headers: string[], rows: (string | number)[][]) =>
      rows.length
        ? `<h2>${escapeHtml(title)}</h2>
           <table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
           <tbody>${rows
             .map(
               (r) =>
                 `<tr>${r.map((c) => `<td class="num">${escapeHtml(c)}</td>`).join("")}</tr>`,
             )
             .join("")}</tbody></table>`
        : "";

    const statusColor =
      kpis.budgetStatus === "safe" ? "#10b981" :
      kpis.budgetStatus === "warning" ? "#f97316" :
      kpis.budgetStatus === "danger" ? "#ef4444" : "#6b7280";

    const body = `
      <header>
        <div>
          <h1>${COMPANY_AR}</h1>
          <div class="en">تقرير التسويق والمبيعات والسوشيال ميديا</div>
        </div>
        <div class="meta">
          <div>الفترة: ${escapeHtml(periodLabel)}</div>
          <div>تاريخ الإصدار: ${fmtDate(new Date())}</div>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><div class="k">إجمالي الطلبات</div><div class="v">${fmtNum(kpis.totalOrders)}</div></div>
        <div class="stat"><div class="k">قيمة الطلبات</div><div class="v">${fmtNum(kpis.totalOrdersValue)}</div></div>
        <div class="stat"><div class="k">المنفذة</div><div class="v">${fmtNum(kpis.deliveredValue)}</div></div>
        <div class="stat"><div class="k">متوسط الأوردر</div><div class="v">${fmtNum(Math.round(kpis.avgOrderValue))}</div></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="k">عملاء جدد</div><div class="v">${fmtNum(kpis.newCustomers)}</div></div>
        <div class="stat"><div class="k">متكررون</div><div class="v">${fmtNum(kpis.repeatCustomers)}</div></div>
        <div class="stat"><div class="k">مجانية</div><div class="v">${fmtNum(kpis.giftOrders)}</div></div>
        <div class="stat"><div class="k">ملغاة</div><div class="v">${fmtNum(kpis.cancelledOrders)}</div></div>
      </div>

      ${table(
        "مصادر العملاء",
        ["المصدر", "طلبات", "مبيعات", "متوسط الأوردر"],
        sourceAgg.map((r) => [r.label, r.orders, Math.round(r.revenue), Math.round(r.avg)]),
      )}

      ${table(
        "المناطق (Top 15)",
        ["المحافظة/المنطقة", "طلبات", "مبيعات", "أعلى مصدر"],
        areaAgg.slice(0, 15).map((r) => [r.area, r.orders, Math.round(r.revenue), r.topSource]),
      )}

      ${table(
        "المنتجات الأعلى مبيعًا (Top 20)",
        ["المنتج", "الكمية", "الإيرادات", "الطلبات"],
        productAgg.slice(0, 20).map((r) => [r.name, r.qty, Math.round(r.revenue), r.ordersCount]),
      )}

      ${table(
        "مصروفات السوشيال المعتمدة",
        ["التاريخ", "النوع", "المنصة", "الحملة", "الموظف", "القيمة"],
        filteredExpenses
          .filter((e) => e.is_approved)
          .map((e) => [e.expense_date, e.expense_type, e.platform || "—", e.campaign_name || "—", e.employee_name || "—", e.amount]),
      )}

      ${table(
        "مصروفات قيد المراجعة",
        ["التاريخ", "النوع", "المنصة", "الحملة", "الموظف", "القيمة"],
        filteredExpenses
          .filter((e) => !e.is_approved)
          .map((e) => [e.expense_date, e.expense_type, e.platform || "—", e.campaign_name || "—", e.employee_name || "—", e.amount]),
      )}

      <h2>نسبة مصروفات السوشيال إلى المبيعات</h2>
      <table>
        <tbody>
          <tr><td>إجمالي المبيعات</td><td class="num">${fmtNum(kpis.totalOrdersValue)}</td></tr>
          <tr><td>المصروفات المعتمدة</td><td class="num">${fmtNum(kpis.approvedExpenses)}</td></tr>
          <tr><td>قيد المراجعة</td><td class="num">${fmtNum(kpis.pendingExpenses)}</td></tr>
          <tr><td>النسبة الرسمية</td><td class="num">${kpis.actualRatio == null ? "—" : kpis.actualRatio.toFixed(2) + "%"}</td></tr>
          <tr><td>حد 5%</td><td class="num">${fmtNum(Math.round(kpis.cost5pct))}</td></tr>
          <tr><td>حد 6%</td><td class="num">${fmtNum(Math.round(kpis.cost6pct))}</td></tr>
        </tbody>
      </table>

      <div style="margin-top:12px; padding:10px; border-radius:6px; background:${statusColor}20; border:2px solid ${statusColor}; color:${statusColor}; font-weight:bold; text-align:center;">
        الحالة: ${escapeHtml(budgetStatusLabel())}
      </div>
    `;
    openPrintWindow(`تقرير التسويق والمبيعات — ${periodLabel}`, body);
  };

  if (!isManager) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-muted-foreground" dir="rtl">
          هذه الصفحة متاحة للمدير العام / التنفيذي / مدير التسويق فقط.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Megaphone className="w-7 h-7 text-primary" />
              تصدير تقارير التسويق والمبيعات والسوشيال
            </h1>
            <p className="text-muted-foreground mt-1">
              تصدير شامل: طلبات، مصادر عملاء، مناطق، منتجات، مصروفات، ونسبة الميزانية.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportPDF} disabled={loading}>
              <Printer className="w-4 h-4 ml-2" /> طباعة PDF عربي
            </Button>
            <Button onClick={exportExcel} disabled={loading}>
              <FileSpreadsheet className="w-4 h-4 ml-2" /> تصدير Excel شامل
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileDown className="w-5 h-5 text-primary" /> الفلاتر
              {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div><Label>من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div><Label>إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>

            <FilterSelect label="مصدر العميل" value={sourceFilter} onChange={setSourceFilter} options={uniqueSources} />
            <FilterSelect label="قناة التواصل" value={channelFilter} onChange={setChannelFilter} options={uniqueChannels} />
            <FilterSelect label="المحافظة" value={governorateFilter} onChange={setGovernorateFilter} options={uniqueGovernorates} />
            <FilterSelect label="المنطقة" value={areaFilter} onChange={setAreaFilter} options={uniqueAreas} />
            <FilterSelect label="اسم الحملة" value={campaignFilter} onChange={setCampaignFilter} options={uniqueCampaigns} />
            <FilterSelect label="حالة الطلب" value={statusFilter} onChange={setStatusFilter} options={uniqueStatuses} />
            <FilterSelect label="المنتج" value={productFilter} onChange={setProductFilter} options={uniqueProducts} />
            <FilterSelect label="نوع المصروف" value={expenseTypeFilter} onChange={setExpenseTypeFilter} options={uniqueExpenseTypes} />
            <FilterSelect label="المنصة" value={platformFilter} onChange={setPlatformFilter} options={uniquePlatforms} />
            <FilterSelect label="الموظف" value={employeeFilter} onChange={setEmployeeFilter} options={uniqueEmployees} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>ملخّص التصدير</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Stat label="طلبات" value={filteredOrders.length} />
            <Stat label="قيمة الطلبات" value={kpis.totalOrdersValue.toLocaleString("ar-EG") + " ج.م"} />
            <Stat label="مصروفات معتمدة" value={approvedExpense.toLocaleString("ar-EG") + " ج.م"} />
            <Stat label="قيد المراجعة" value={pendingExpense.toLocaleString("ar-EG") + " ج.م"} />
            <Stat label="نسبة المصروفات" value={kpis.actualRatio == null ? "—" : kpis.actualRatio.toFixed(2) + " %"} />
            <Stat label="الحالة" value={budgetStatusLabel()} />
            <Stat label="تقارير يومية" value={filteredDailyReports.length} />
            <Stat label="تقارير أسبوعية" value={filteredWeeklyReports.length} />
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">الكل</SelectItem>
          {options.filter(Boolean).map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="p-3 rounded-md bg-muted/40">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}
