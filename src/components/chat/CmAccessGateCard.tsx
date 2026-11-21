import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { canChangeCmGate, type CmAccessMode } from "@/config/chatManagement";
import { setCmGateModeCache, useCmFeatureGate } from "@/hooks/useCmFeatureGate";

/** مفتاح بوابة القسم — يظهر للمدير العام فقط. التغيير عبر cm_set_feature_gate (مُدقَّق في cm_audit_log). */
export default function CmAccessGateCard() {
  const { roles } = useAuth() as { roles?: string[] };
  const { mode } = useCmFeatureGate();
  const [pending, setPending] = useState<CmAccessMode | null>(null);
  const [saving, setSaving] = useState(false);
  if (!canChangeCmGate(roles)) return null;

  const rolesOn = mode === "roles";
  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    const { error } = await (supabase as any).rpc("cm_set_feature_gate", { _mode: pending });
    setSaving(false);
    if (error) { toast.error("تعذّر تغيير صلاحية الوصول", { description: error.message }); return; }
    setCmGateModeCache(pending);
    toast.success(pending === "roles" ? "فُتح القسم حسب مصفوفة الأدوار" : "أُغلق القسم على المدير العام فقط");
    setPending(null);
  };

  return (
    <Card className="border-[#A4288A]/40" data-testid="cm-gate-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[#662D8C]"><ShieldCheck className="h-5 w-5" />صلاحية الوصول إلى قسم «إدارة المحادثات»</CardTitle>
        <CardDescription>
          {rolesOn
            ? "الوضع الحالي: مفتوح حسب مصفوفة الأدوار (مديرة المبيعات، المدير التنفيذي، المودريتور، التسويق...)."
            : "الوضع الحالي: مقفل — لا يفتح القسم أحد غير المدير العام."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <Label htmlFor="cm-gate-switch">فتح القسم لباقي الأدوار حسب الصلاحيات</Label>
        <Switch id="cm-gate-switch" checked={rolesOn} disabled={saving}
          onCheckedChange={(v) => setPending(v ? "roles" : "general_manager_only")} />
      </CardContent>
      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{pending === "roles" ? "فتح القسم لباقي الأدوار؟" : "قفل القسم على المدير العام فقط؟"}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "roles"
                ? "سيتمكن كل دور من الوصول إلى صفحات «إدارة المحادثات» وبياناتها حسب مصفوفة الصلاحيات المعتمدة. يُسجَّل هذا التغيير في سجل التدقيق."
                : "سيُحجب القسم وبياناته فوراً عن جميع المستخدمين عدا المدير العام. يُسجَّل هذا التغيير في سجل التدقيق."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={saving} className="bg-[#A4288A] hover:bg-[#662D8C] text-white">تأكيد</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
