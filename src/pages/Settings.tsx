import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Settings as SettingsIcon, Building2, Bell, CreditCard, Shield, Volume2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNotificationSettings } from "@/hooks/useNotificationSettings";
import UpdateLogPanel from "@/components/UpdateLogPanel";
import { useAuth } from "@/hooks/useAuth";

const Settings = () => {
  const { toast } = useToast();
  const { settings, updateSettings } = useNotificationSettings();

  const handleSave = () => {
    toast({
      title: "تم الحفظ",
      description: "تم حفظ الإعدادات بنجاح",
    });
  };

  return (
    <DashboardLayout>
      <Header title="الإعدادات" subtitle="إعدادات النظام والتفضيلات" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Company Info */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-primary" />
              معلومات الشركة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>اسم الشركة</Label>
              <Input
                defaultValue="شركة نعام العاصمة"
                className="input-modern"
              />
            </div>
            <div className="space-y-2">
              <Label>رقم الهاتف</Label>
              <Input
                defaultValue="+20 109 202 7214"
                className="input-modern"
              />
            </div>
            <div className="space-y-2">
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                defaultValue="info@capitalostrich.com"
                className="input-modern"
              />
            </div>
            <div className="space-y-2">
              <Label>العنوان</Label>
              <Input
                defaultValue="مصر"
                className="input-modern"
              />
            </div>
            <Button onClick={handleSave} className="btn-primary w-full">
              حفظ التغييرات
            </Button>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-secondary" />
              الإشعارات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">إشعارات الطلبات الجديدة</p>
                <p className="text-sm text-muted-foreground">
                  استلم إشعار عند وصول طلب جديد
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="font-medium">صوت الإشعارات</p>
                  <p className="text-sm text-muted-foreground">
                    تشغيل صوت تنبيه مع الإشعارات
                  </p>
                </div>
              </div>
              <Switch 
                checked={settings.soundEnabled} 
                onCheckedChange={(checked) => updateSettings({ soundEnabled: checked })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">تنبيهات المخزون</p>
                <p className="text-sm text-muted-foreground">
                  تنبيه عند انخفاض المخزون
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">إشعارات البريد الإلكتروني</p>
                <p className="text-sm text-muted-foreground">
                  استلم التقارير اليومية عبر البريد
                </p>
              </div>
              <Switch />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">إشعارات الدفع</p>
                <p className="text-sm text-muted-foreground">
                  تنبيه عند اكتمال عملية دفع
                </p>
              </div>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        {/* Payment Settings */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-success" />
              إعدادات الدفع
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">الدفع الإلكتروني</p>
                <p className="text-sm text-muted-foreground">
                  تفعيل البوابات الإلكترونية
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">الدفع عند الاستلام</p>
                <p className="text-sm text-muted-foreground">
                  السماح بالدفع الكاش
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />
            <div className="space-y-2">
              <Label>الحد الأدنى للطلب (ج.م)</Label>
              <Input
                type="number"
                defaultValue="100"
                className="input-modern"
              />
            </div>
            <div className="space-y-2">
              <Label>رسوم التوصيل (ج.م)</Label>
              <Input
                type="number"
                defaultValue="50"
                className="input-modern"
              />
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-destructive" />
              الأمان
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>كلمة المرور الحالية</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="input-modern"
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور الجديدة</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="input-modern"
              />
            </div>
            <div className="space-y-2">
              <Label>تأكيد كلمة المرور</Label>
              <Input
                type="password"
                placeholder="••••••••"
                className="input-modern"
              />
            </div>
            <Button onClick={handleSave} className="btn-primary w-full">
              تغيير كلمة المرور
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
