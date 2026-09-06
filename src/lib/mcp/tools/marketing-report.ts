import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "marketing_report",
  title: "Marketing & moderators report",
  description:
    "تقرير التسويق والمودريتور: أهداف الموظفين والمحقق منها، أداء المودريتور من الطلبات (عدد الطلبات والمسلّم والقيمة)، تقارير السوشيال ميديا اليومية والأسبوعية، ومصروفات الإعلانات حسب المنصة والحملة.",
  inputSchema: {
    month: z.number().optional().describe("الشهر 1-12 (افتراضي الشهر الحالي)."),
    year: z.number().optional().describe("السنة (افتراضي السنة الحالية)."),
    include_social: z.boolean().optional().describe("تضمين تقارير السوشيال ميديا (افتراضي true)."),
    limit: z.number().optional().describe("حد الصفوف (افتراضي 500، أقصى 2000)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month, year, include_social, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const supabase = supabaseForUser(ctx);
    const now = new Date();
    const m = month ?? now.getUTCMonth() + 1;
    const y = year ?? now.getUTCFullYear();
    const cap = Math.min(Math.max(limit ?? 500, 1), 2000);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const end = new Date(Date.UTC(y, m, 1)).toISOString();
    const startDate = start.slice(0, 10);
    const endDate = end.slice(0, 10);

    const social = include_social === false;
    const [targets, orders, daily, weekly, expenses] = await Promise.all([
      supabase.from("sales_targets").select("*").eq("month", m).eq("year", y).limit(cap),
      supabase
        .from("orders")
        .select("id,moderator,status,total,source,created_at")
        .gte("created_at", start)
        .lt("created_at", end)
        .limit(5000),
      social
        ? Promise.resolve({ data: [], error: null } as any)
        : supabase
            .from("social_media_daily_reports")
            .select(
              "id,report_date,employee_name,posts_count,reels_videos_count,interested_customers_count,reach_count,impressions_count,likes_count,comments_count,shares_count,new_followers_count,status",
            )
            .gte("report_date", startDate)
            .lt("report_date", endDate)
            .limit(cap),
      social
        ? Promise.resolve({ data: [], error: null } as any)
        : supabase
            .from("social_media_weekly_reports")
            .select(
              "id,week_start_date,week_end_date,employee_name,facebook_followers_growth,instagram_followers_growth,tiktok_followers_growth,youtube_followers_growth,leads_count,best_platform,status",
            )
            .gte("week_start_date", startDate)
            .lt("week_start_date", endDate)
            .limit(cap),
      supabase
        .from("social_media_expenses")
        .select("id,expense_date,expense_type,platform,campaign_name,amount,is_approved")
        .gte("expense_date", startDate)
        .lt("expense_date", endDate)
        .limit(cap),
    ]);

    const err = targets.error || orders.error || daily.error || weekly.error || expenses.error;
    if (err) return { content: [{ type: "text", text: err.message }], isError: true };

    const rows = (orders.data as any[]) ?? [];
    const num = (v: any) => Number(v ?? 0);
    const perModerator = rows.reduce<Record<string, any>>((acc, o) => {
      const k = String(o.moderator ?? "غير محدد");
      acc[k] = acc[k] ?? { orders: 0, orders_value: 0, delivered: 0, delivered_value: 0, cancelled: 0 };
      acc[k].orders += 1;
      acc[k].orders_value += num(o.total);
      if (o.status === "delivered") {
        acc[k].delivered += 1;
        acc[k].delivered_value += num(o.total);
      }
      if (o.status === "cancelled") acc[k].cancelled += 1;
      return acc;
    }, {});
    const bySource = rows.reduce<Record<string, { orders: number; value: number }>>((acc, o) => {
      const k = String(o.source ?? "غير محدد");
      acc[k] = acc[k] ?? { orders: 0, value: 0 };
      acc[k].orders += 1;
      acc[k].value += num(o.total);
      return acc;
    }, {});

    const exp = (expenses.data as any[]) ?? [];
    const adSpend = exp.reduce((a, e) => a + num(e.amount), 0);
    const deliveredValue = rows
      .filter((o) => o.status === "delivered")
      .reduce((a, o) => a + num(o.total), 0);

    const socialRows = (daily.data as any[]) ?? [];
    const payload = {
      period: { month: m, year: y },
      currency: "EGP",
      targets: targets.data ?? [],
      moderators_performance: perModerator,
      orders_by_source: bySource,
      ad_spend: {
        total: adSpend,
        approved: exp.filter((e) => e.is_approved).reduce((a, e) => a + num(e.amount), 0),
        by_platform: exp.reduce<Record<string, number>>((acc, e) => {
          const k = String(e.platform ?? "غير محدد");
          acc[k] = (acc[k] ?? 0) + num(e.amount);
          return acc;
        }, {}),
        by_campaign: exp.reduce<Record<string, number>>((acc, e) => {
          const k = String(e.campaign_name ?? "غير محدد");
          acc[k] = (acc[k] ?? 0) + num(e.amount);
          return acc;
        }, {}),
      },
      delivered_sales_value: deliveredValue,
      roas_delivered_over_adspend: adSpend > 0 ? Number((deliveredValue / adSpend).toFixed(2)) : null,
      social_media: {
        daily_reports_count: socialRows.length,
        totals: {
          posts: socialRows.reduce((a, r) => a + num(r.posts_count), 0),
          reels_videos: socialRows.reduce((a, r) => a + num(r.reels_videos_count), 0),
          interested_customers: socialRows.reduce((a, r) => a + num(r.interested_customers_count), 0),
          reach: socialRows.reduce((a, r) => a + num(r.reach_count), 0),
          impressions: socialRows.reduce((a, r) => a + num(r.impressions_count), 0),
          new_followers: socialRows.reduce((a, r) => a + num(r.new_followers_count), 0),
        },
        weekly_reports: weekly.data ?? [],
      },
      note: "الفترة على تاريخ إنشاء الطلب (UTC). المبيعات المعتمدة هي الطلبات بحالة delivered فقط، والإلغاءات مستبعدة من المبيعات.",
    };
    return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload as any };
  },
});
