import { useEffect, useState } from "react";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { History } from "lucide-react";

const statusBadge = (s: string) => {
  if (s === "reviewed")
    return <Badge className="bg-emerald-500 hover:bg-emerald-600">تمت المراجعة</Badge>;
  if (s === "submitted") return <Badge className="bg-blue-500 hover:bg-blue-600">تم الإرسال</Badge>;
  return <Badge variant="outline">مسودة</Badge>;
};

export default function SocialMediaMyReports() {
  const { user } = useAuth();
  const [daily, setDaily] = useState<any[]>([]);
  const [weekly, setWeekly] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const [d, w] = await Promise.all([
        supabase
          .from("social_media_daily_reports")
          .select("*")
          .eq("employee_id", user.id)
          .order("report_date", { ascending: false }),
        supabase
          .from("social_media_weekly_reports")
          .select("*")
          .eq("employee_id", user.id)
          .order("week_start_date", { ascending: false }),
      ]);
      setDaily(d.data || []);
      setWeekly(w.data || []);
      setLoading(false);
    })();
  }, [user]);

  return (
    <DashboardLayout>
      <div className="space-y-6" dir="rtl">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="w-7 h-7 text-primary" /> تقاريري السابقة
          </h1>
          <p className="text-muted-foreground mt-1">سجل كل تقاريرك اليومية والأسبوعية.</p>
        </div>

        <Tabs defaultValue="daily">
          <TabsList>
            <TabsTrigger value="daily">التقارير اليومية ({daily.length})</TabsTrigger>
            <TabsTrigger value="weekly">التقارير الأسبوعية ({weekly.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            <Card>
              <CardHeader>
                <CardTitle>التقارير اليومية</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-muted-foreground">جاري التحميل…</p>
                ) : daily.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">لا توجد تقارير بعد.</p>
                ) : (
                  <>
                    {/* Mobile cards */}
                    <div className="grid gap-3 md:hidden">
                      {daily.map((r) => (
                        <div key={r.id} className="rounded-lg border p-3 bg-card space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{r.report_date}</span>
                            {statusBadge(r.status)}
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-sm">
                            <div className="text-center bg-muted/40 rounded p-2">
                              <div className="text-xs text-muted-foreground">بوستات</div>
                              <div className="font-bold">{r.posts_count}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-2">
                              <div className="text-xs text-muted-foreground">ريلز</div>
                              <div className="font-bold">{r.reels_videos_count}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-2">
                              <div className="text-xs text-muted-foreground">مهتمين</div>
                              <div className="font-bold">{r.interested_customers_count}</div>
                            </div>
                          </div>
                          {r.top_engaging_content && (
                            <div className="text-sm">
                              <span className="text-muted-foreground">أعلى محتوى: </span>
                              {r.top_engaging_content}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Desktop table */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>التاريخ</TableHead>
                            <TableHead>البوستات</TableHead>
                            <TableHead>الريلز</TableHead>
                            <TableHead>عملاء مهتمين</TableHead>
                            <TableHead>أعلى محتوى</TableHead>
                            <TableHead>الحالة</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {daily.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>{r.report_date}</TableCell>
                              <TableCell>{r.posts_count}</TableCell>
                              <TableCell>{r.reels_videos_count}</TableCell>
                              <TableCell>{r.interested_customers_count}</TableCell>
                              <TableCell className="max-w-[200px] truncate">
                                {r.top_engaging_content}
                              </TableCell>
                              <TableCell>{statusBadge(r.status)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="weekly">
            <Card>
              <CardHeader>
                <CardTitle>التقارير الأسبوعية</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-muted-foreground">جاري التحميل…</p>
                ) : weekly.length === 0 ? (
                  <p className="text-muted-foreground text-center py-6">لا توجد تقارير بعد.</p>
                ) : (
                  <>
                    {/* Mobile cards */}
                    <div className="grid gap-3 md:hidden">
                      {weekly.map((r) => (
                        <div key={r.id} className="rounded-lg border p-3 bg-card space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">
                              {r.week_start_date} → {r.week_end_date}
                            </span>
                            {statusBadge(r.status)}
                          </div>
                          <div className="grid grid-cols-4 gap-1 text-xs">
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">FB</div>
                              <div className="font-bold">{r.facebook_followers_growth}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">IG</div>
                              <div className="font-bold">{r.instagram_followers_growth}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">TT</div>
                              <div className="font-bold">{r.tiktok_followers_growth}</div>
                            </div>
                            <div className="text-center bg-muted/40 rounded p-1.5">
                              <div className="text-muted-foreground">YT</div>
                              <div className="font-bold">{r.youtube_followers_growth}</div>
                            </div>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span><span className="text-muted-foreground">Leads: </span>{r.leads_count}</span>
                            <span><span className="text-muted-foreground">أفضل: </span>{r.best_platform}</span>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Desktop table */}
                    <div className="hidden md:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>الأسبوع</TableHead>
                            <TableHead>FB</TableHead>
                            <TableHead>IG</TableHead>
                            <TableHead>TikTok</TableHead>
                            <TableHead>YouTube</TableHead>
                            <TableHead>Leads</TableHead>
                            <TableHead>أفضل منصة</TableHead>
                            <TableHead>الحالة</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {weekly.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell>
                                {r.week_start_date} → {r.week_end_date}
                              </TableCell>
                              <TableCell>{r.facebook_followers_growth}</TableCell>
                              <TableCell>{r.instagram_followers_growth}</TableCell>
                              <TableCell>{r.tiktok_followers_growth}</TableCell>
                              <TableCell>{r.youtube_followers_growth}</TableCell>
                              <TableCell>{r.leads_count}</TableCell>
                              <TableCell>{r.best_platform}</TableCell>
                              <TableCell>{statusBadge(r.status)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
