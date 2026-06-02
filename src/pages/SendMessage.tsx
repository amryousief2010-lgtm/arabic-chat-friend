import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Send, MessageSquare } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface UserOption {
  id: string;
  full_name: string | null;
  email: string;
  role?: string;
}

const TEMPLATES: Record<string, { title: string; body: string }> = {
  accountant_welcome: {
    title: "مرحباً بك كمحاسب عام على التطبيق",
    body:
      "أهلاً بك،\nتم تفعيل حسابك كـ محاسب عام. مهامك الأساسية:\n" +
      "1) تأكيد التحصيل لكل طلب من صفحة الطلبات.\n" +
      "2) تحديث حالة الدفع من تفاصيل الطلب.\n" +
      "3) إدخال التكلفة الفعلية وهامش الربح من صفحة 'تكاليف المنتجات'.\n" +
      "4) متابعة التقارير المالية واللوحات التنفيذية.\n\nبالتوفيق 💪",
  },
  custom: { title: "", body: "" },
};

const SendMessage = () => {
  const { role } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [targetUserId, setTargetUserId] = useState<string>("");
  const [template, setTemplate] = useState<string>("custom");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const canSend = ["general_manager", "executive_manager", "sales_manager", "marketing_sales_manager", "financial_manager", "accountant"].includes(
    role || ""
  );

  const { data: users = [] } = useQuery({
    queryKey: ["users-for-message"],
    queryFn: async () => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("full_name");
      if (error) throw error;
      const { data: roles } = await supabase.from("user_roles").select("user_id, role");
      const roleMap = new Map((roles || []).map((r: any) => [r.user_id, r.role]));
      return (profiles || []).map((p) => ({ ...p, role: roleMap.get(p.id) as string | undefined })) as UserOption[];
    },
    enabled: canSend,
  });

  const onTemplateChange = (key: string) => {
    setTemplate(key);
    const tpl = TEMPLATES[key];
    if (tpl) {
      setTitle(tpl.title);
      setBody(tpl.body);
    }
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!targetUserId) throw new Error("اختر المستلم");
      if (!title.trim() || !body.trim()) throw new Error("العنوان والمحتوى مطلوبان");
      const { error } = await supabase.from("notifications").insert({
        title: title.trim(),
        description: body.trim(),
        type: "direct_message",
        target_user_id: targetUserId,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "تم إرسال الرسالة بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      setTitle("");
      setBody("");
      setTargetUserId("");
      setTemplate("custom");
    },
    onError: (e: Error) => {
      toast({ title: "تعذر الإرسال", description: e.message, variant: "destructive" });
    },
  });

  if (!canSend) {
    return (
      <DashboardLayout>
        <Header title="إرسال رسالة" subtitle="غير مصرح" />
        <Card className="glass-card">
          <CardContent className="py-10 text-center text-muted-foreground">
            هذه الصفحة متاحة للإدارة فقط.
          </CardContent>
        </Card>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <Header
        title="إرسال رسالة داخلية"
        subtitle="إرسال إشعارات وتعليمات لأي موظف داخل التطبيق"
      />

      <Card className="glass-card max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            رسالة جديدة
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">المستلم</label>
            <Select value={targetUserId} onValueChange={setTargetUserId}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الموظف" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name || u.email} {u.role ? `— ${u.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">قالب جاهز</label>
            <Select value={template} onValueChange={onTemplateChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">رسالة مخصصة</SelectItem>
                <SelectItem value="accountant_welcome">ترحيب بالمحاسب وشرح المهام</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">العنوان</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">نص الرسالة</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              maxLength={2000}
              className="resize-none"
            />
            <div className="text-xs text-muted-foreground text-left mt-1">{body.length}/2000</div>
          </div>

          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending}
            className="w-full gap-2"
          >
            <Send className="w-4 h-4" />
            إرسال الرسالة
          </Button>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default SendMessage;
