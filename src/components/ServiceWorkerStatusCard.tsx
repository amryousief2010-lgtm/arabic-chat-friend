import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw } from "lucide-react";
import { getLastCheck, subscribeToChecks } from "@/lib/updateChecker";
import { checkForServiceWorkerUpdate } from "@/lib/registerSW";
import { toast } from "sonner";

type SWState =
  | "active"
  | "waiting"
  | "installing"
  | "unregistered"
  | "unsupported";

const stateLabel: Record<SWState, string> = {
  active: "يعمل حالياً",
  waiting: "في الانتظار",
  installing: "يتم التثبيت",
  unregistered: "غير مسجل",
  unsupported: "غير مدعوم",
};

const stateVariant: Record<SWState, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  waiting: "secondary",
  installing: "outline",
  unregistered: "outline",
  unsupported: "destructive",
};

const ServiceWorkerStatusCard = () => {
  const [swState, setSwState] = useState<SWState>("unsupported");
  const [lastCheck, setLastCheck] = useState<ReturnType<typeof getLastCheck>>(null);
  const [checking, setChecking] = useState(false);

  const refreshState = useCallback(async () => {
    if (!("serviceWorker" in navigator)) {
      setSwState("unsupported");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) {
        setSwState("unregistered");
        return;
      }
      if (reg.waiting) {
        setSwState("waiting");
      } else if (reg.installing) {
        setSwState("installing");
      } else if (reg.active) {
        setSwState("active");
      } else {
        setSwState("unregistered");
      }
    } catch {
      setSwState("unsupported");
    }
    setLastCheck(getLastCheck());
  }, []);

  useEffect(() => {
    void refreshState();
    const unsub = subscribeToChecks(() => setLastCheck(getLastCheck()));
    return () => unsub();
  }, [refreshState]);

  const handleCheck = async () => {
    setChecking(true);
    try {
      const res = await checkForServiceWorkerUpdate();
      if (res === "updated") {
        toast.success("تم تفعيل نسخة جديدة — جارٍ إعادة التحميل...");
      } else if (res === "current") {
        toast.success("لا توجد تحديثات جديدة");
      } else {
        toast("Service Worker غير مفعّل في هذه البيئة");
      }
    } catch (e) {
      toast.error("فشل فحص التحديث", { description: (e as Error)?.message });
    } finally {
      setChecking(false);
      void refreshState();
    }
  };

  const lastCheckText = lastCheck
    ? new Date(lastCheck.at).toLocaleString("ar-EG")
    : "—";

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          حالة التطبيق
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-muted-foreground text-xs">حالة Service Worker</div>
            <div className="mt-1">
              <Badge variant={stateVariant[swState]}>{stateLabel[swState]}</Badge>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-muted-foreground text-xs">آخر فحص للتحديث</div>
            <div className="font-mono mt-1 text-xs">{lastCheckText}</div>
          </div>
        </div>

        <Button onClick={handleCheck} disabled={checking} size="sm" className="w-full">
          <RefreshCw className={`w-4 h-4 ml-2 ${checking ? "animate-spin" : ""}`} />
          فحص الآن
        </Button>
      </CardContent>
    </Card>
  );
};

export default ServiceWorkerStatusCard;
