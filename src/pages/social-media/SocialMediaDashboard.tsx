import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Megaphone,
  Image as ImageIcon,
  Video,
  Users,
  TrendingUp,
  CalendarCheck,
  AlertTriangle,
  ShieldCheck,
  Lightbulb,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  UserPlus,
  Sparkles,
  FileDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type Row = {
  id: string;
  report_date: string;
  employee_id: string;
  employee_name: string;
  posts_count: number;
  reels_videos_count: number;
  interested_customers_count: number;
  top_engaging_content: string | null;
  issues_or_complaints: string | null;
  tomorrow_content_suggestions: string | null;
  status: string;
  reach_count: number | null;
  impressions_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  new_followers_count: number | null;
  platforms: string[] | null;
  complaint_attachment_path: string | null;
};

const startOfMonthISO = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayISO = () => new Date().toISOString().slice(0, 10);

const KPI = ({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  color: string;
}) => (
  <Card>
    <CardContent className="p-4 flex items-center gap-3">
      <div
        className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}
      >
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground truncate">{label}</div>
        <div className="text-lg font-bold">{value}</div>
      </div>
    </CardContent>
  </Card>
);

const PIE_COLORS = ["#8b5cf6", "#f97316", "#3b82f6", "#10b981", "#ef4444"];

// Map raw orders.source values to normalized social-media platforms
const SOCIAL_SOURCE_MAP: Record<string, string> = {
  "فيسبوك": "Facebook",
  "حملات فيسبوك": "Facebook",
  "واتساب": "WhatsApp",
  "حملات واتساب": "WhatsApp",
  "حملات واتس": "WhatsApp",
  "مكالمة / واتساب": "WhatsApp",
  "تلجرام": "Telegram",
  "تليجرام": "Telegram",
  "تلجيرام": "Telegram",
  "انستجرام": "Instagram",
  "إعلان": "إعلانات",
  "اعلان": "إعلانات",
  "تسويق": "تسويق",
  "ويب سايت": "Website",
};
const normalizeSocialSource = (src?: string | null) =>
  src ? SOCIAL_SOURCE_MAP[src.trim()] ?? null : null;

type SocialOrderRow = {
  created_at: string;
  total: number | null;
  status: string | null;
  source: string | null;
};

export default function SocialMediaDashboard() {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const isManager =
    isGeneralManager ||
    isExecutiveManager ||
    (roles || []).includes("marketing_sales_manager");

  const [from, setFrom] = useState(startOfMonthISO());
  const [to, setTo] = useState(todayISO());
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [socialOrders, setSocialOrders] = useState<SocialOrderRow[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase
        .from("social_media_daily_reports")
        .select("*")
        .gte("report_date", from)
        .lte("report_date", to)
        .order("report_date", { ascending: true });
      if (!isManager && user) q = q.eq("employee_id", user.id);
      const { data } = await q;
      setRows((data as any) || []);
      setLoading(false);
    })();
  }, [from, to, user, isManager]);

  // Load orders coming from social-media sources over the last 3 months
  useEffect(() => {
    (async () => {
      setOrdersLoading(true);
      const since = new Date();
      since.setMonth(since.getMonth() - 3);
      const acc: SocialOrderRow[] = [];
      const pageSize = 1000;
      let offset = 0;
      // paginate to bypass 1000-row cap
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("created_at,total,status,source")
          .gte("created_at", since.toISOString())
          .not("source", "is", null)
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1);
        if (error || !data || data.length === 0) break;
        acc.push(...(data as any));
        if (data.length < pageSize) break;
        offset += pageSize;
      }
      const socialOnly = acc.filter((o) => normalizeSocialSource(o.source));
      setSocialOrders(socialOnly);
      setOrdersLoading(false);
    })();
  }, []);


  const filtered = useMemo(
    () =>
      employeeFilter === "all"
        ? rows
        : rows.filter((r) => r.employee_id === employeeFilter),
    [rows, employeeFilter],
  );

  const employees = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => map.set(r.employee_id, r.employee_name));
    return Array.from(map.entries());
  }, [rows]);

  const kpis = useMemo(() => {
    const sum = (k: keyof Row) =>
      filtered.reduce((acc, r) => acc + (Number(r[k] as any) || 0), 0);
    const daysBetween =
      Math.max(1, Math.ceil((+new Date(to) - +new Date(from)) / 86400000) + 1);
    const submittedDays = new Set(
      filtered
        .filter((r) => r.status === "submitted" || r.status === "reviewed")
        .map((r) => r.report_date),
    ).size;
    const complaints = filtered.filter((r) =>
      (r.issues_or_complaints || "").trim(),
    ).length;
    const suggestions = filtered.filter((r) =>
      (r.tomorrow_content_suggestions || "").trim(),
    ).length;
    return {
      posts: sum("posts_count"),
      reels: sum("reels_videos_count"),
      leads: sum("interested_customers_count"),
      reach: sum("reach_count"),
      impressions: sum("impressions_count"),
      likes: sum("likes_count"),
      comments: sum("comments_count"),
      shares: sum("shares_count"),
      followers: sum("new_followers_count"),
      avgPostsPerDay: submittedDays ? (sum("posts_count") / submittedDays).toFixed(1) : "0",
      submittedDays,
      commitmentRate: `${Math.round((submittedDays / daysBetween) * 100)}%`,
      complaints,
      suggestions,
    };
  }, [filtered, from, to]);

  const dailySeries = useMemo(() => {
    const map = new Map<string, { date: string; posts: number; reels: number; leads: number }>();
    filtered.forEach((r) => {
      const e = map.get(r.report_date) || {
        date: r.report_date,
        posts: 0,
        reels: 0,
        leads: 0,
      };
      e.posts += r.posts_count || 0;
      e.reels += r.reels_videos_count || 0;
      e.leads += r.interested_customers_count || 0;
      map.set(r.report_date, e);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered]);

  const topDays = useMemo(
    () => [...dailySeries].sort((a, b) => b.leads - a.leads).slice(0, 5),
    [dailySeries],
  );

  const contentMix = useMemo(
    () => [
      { name: "بوستات", value: kpis.posts },
      { name: "ريلز / فيديو", value: kpis.reels },
    ],
    [kpis],
  );

  const complaintsList = useMemo(
    () =>
      filtered
        .filter((r) => (r.issues_or_complaints || "").trim())
        .slice(-10)
        .reverse(),
    [filtered],
  );

  const topContent = useMemo(
    () =>
      filtered
        .filter((r) => (r.top_engaging_content || "").trim())
        .slice(-10)
        .reverse(),
    [filtered],
  );

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Megaphone className="w-7 h-7 text-primary" />
              لوحة السوشيال ميديا
            </h1>
            <p className="text-muted-foreground mt-1">
              مؤشرات الأداء ومحتوى التفاعل والشكاوى في فترة زمنية.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link to="/social-media/export">
                <FileDown className="w-4 h-4 ml-2" /> تصدير التقارير
              </Link>
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>من</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label>إلى</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            {isManager && (
              <div className="md:col-span-2">
                <Label>الموظفة</Label>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">كل الموظفات</SelectItem>
                    {employees.map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI icon={ImageIcon} label="بوستات" value={kpis.posts} color="bg-purple-500" />
          <KPI icon={Video} label="ريلز / فيديو" value={kpis.reels} color="bg-orange-500" />
          <KPI icon={Users} label="عملاء مهتمين" value={kpis.leads} color="bg-blue-500" />
          <KPI icon={TrendingUp} label="متوسط بوستات/يوم" value={kpis.avgPostsPerDay} color="bg-emerald-500" />
          <KPI icon={CalendarCheck} label="أيام مُرسلة" value={kpis.submittedDays} color="bg-cyan-600" />
          <KPI icon={ShieldCheck} label="معدل الالتزام" value={kpis.commitmentRate} color="bg-indigo-500" />
          <KPI icon={AlertTriangle} label="الشكاوى" value={kpis.complaints} color="bg-red-500" />
          <KPI icon={Lightbulb} label="اقتراحات محتوى" value={kpis.suggestions} color="bg-yellow-500" />
        </div>

        {/* Optional engagement KPIs */}
        {(kpis.reach + kpis.impressions + kpis.likes + kpis.comments + kpis.shares + kpis.followers) > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <KPI icon={Eye} label="الوصول" value={kpis.reach} color="bg-sky-500" />
            <KPI icon={Sparkles} label="الظهور" value={kpis.impressions} color="bg-fuchsia-500" />
            <KPI icon={Heart} label="إعجابات" value={kpis.likes} color="bg-pink-500" />
            <KPI icon={MessageCircle} label="تعليقات" value={kpis.comments} color="bg-teal-500" />
            <KPI icon={Share2} label="مشاركات" value={kpis.shares} color="bg-amber-600" />
            <KPI icon={UserPlus} label="متابعون جدد" value={kpis.followers} color="bg-lime-600" />
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>الأداء اليومي</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {loading ? (
                <p className="text-muted-foreground">جاري التحميل…</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailySeries}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={11} />
                    <YAxis fontSize={11} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="posts" name="بوستات" stroke="#8b5cf6" />
                    <Line type="monotone" dataKey="reels" name="ريلز" stroke="#f97316" />
                    <Line type="monotone" dataKey="leads" name="عملاء مهتمين" stroke="#3b82f6" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>توزيع المحتوى</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={contentMix} dataKey="value" nameKey="name" outerRadius={80} label>
                    {contentMix.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>أعلى 5 أيام في العملاء المهتمين</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topDays}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Bar dataKey="leads" name="عملاء مهتمين" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Complaints */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" /> آخر الشكاوى
            </CardTitle>
          </CardHeader>
          <CardContent>
            {complaintsList.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا توجد شكاوى مسجّلة في هذه الفترة.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الموظفة</TableHead>
                    <TableHead>الشكوى</TableHead>
                    <TableHead>مرفق</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {complaintsList.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.report_date}</TableCell>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell className="max-w-md">{r.issues_or_complaints}</TableCell>
                      <TableCell>
                        {r.complaint_attachment_path ? (
                          <Badge variant="secondary">مرفق</Badge>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Top content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" /> أعلى محتوى تفاعلًا
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topContent.length === 0 ? (
              <p className="text-muted-foreground text-sm">لا يوجد محتوى مسجّل في هذه الفترة.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الموظفة</TableHead>
                    <TableHead>المحتوى</TableHead>
                    <TableHead>عملاء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topContent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.report_date}</TableCell>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell className="max-w-md">{r.top_engaging_content}</TableCell>
                      <TableCell>{r.interested_customers_count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
