import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Trash2, Download } from "lucide-react";
import {
  CURRENT_VERSION,
  CHECK_INTERVAL_MS,
  CHECK_ON_FOCUS,
  fetchRemoteVersion,
  getReloadLog,
  clearReloadLog,
  checkAndReloadIfStale,
  type ReloadLogEntry,
} from "@/lib/updateChecker";
import { toast } from "sonner";

const reasonLabel: Record<ReloadLogEntry["reason"], string> = {
  boot: "عند الإقلاع",
  interval: "فحص دوري",
  focus: "عند التركيز",
  visibility: "عند الظهور",
  pageshow: "عند الرجوع للصفحة",
  "post-login": "بعد تسجيل الدخول",
  manual: "يدوي",
  "sw-activated": "تفعيل SW جديد",
};

const UpdateLogPanel = () => {
  const [log, setLog] = useState<ReloadLogEntry[]>([]);
  const [remote, setRemote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setLog(getReloadLog());
    setChecking(true);
    const r = await fetchRemoteVersion();
    setRemote(r.remote);
    setChecking(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleForceCheck = async () => {
    setChecking(true);
    const reloaded = await checkAndReloadIfStale("manual");
    if (!reloaded) toast.success("أنت على آخر إصدار");
    setChecking(false);
    setLog(getReloadLog());
  };

  const handleClear = () => {
    clearReloadLog();
    setLog([]);
    toast.success("تم مسح السجل");
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5 text-primary" />
          سجل تحديثات التطبيق
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-muted-foreground text-xs">الإصدار الحالي</div>
            <div className="font-mono mt-1">{CURRENT_VERSION}</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-muted-foreground text-xs">الإصدار على الخادم</div>
            <div className="font-mono mt-1">
              {remote ?? "—"}
              {remote && remote !== CURRENT_VERSION && (
                <Badge variant="destructive" className="mr-2">قديم</Badge>
              )}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-muted-foreground text-xs">تكرار الفحص</div>
            <div className="font-mono mt-1">{Math.round(CHECK_INTERVAL_MS / 1000)} ثانية</div>
          </div>
          <div className="p-3 rounded-lg bg-muted/40">
            <div className="text-muted-foreground text-xs">فحص عند التركيز</div>
            <div className="font-mono mt-1">{CHECK_ON_FOCUS ? "مُفعّل" : "معطّل"}</div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          يمكن تخصيص التكرار عبر متغيرات البيئة:{" "}
          <code className="font-mono">VITE_UPDATE_CHECK_INTERVAL_MS</code> و{" "}
          <code className="font-mono">VITE_UPDATE_CHECK_ON_FOCUS</code>.
        </p>

        <div className="flex gap-2">
          <Button onClick={handleForceCheck} disabled={checking} size="sm">
            <RefreshCw className={`w-4 h-4 ml-2 ${checking ? "animate-spin" : ""}`} />
            فحص الآن
          </Button>
          <Button onClick={handleClear} variant="outline" size="sm" disabled={!log.length}>
            <Trash2 className="w-4 h-4 ml-2" />
            مسح السجل
          </Button>
        </div>

        <div className="space-y-2 max-h-64 overflow-auto">
          {log.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              لا توجد عمليات إعادة تحميل مسجّلة بعد
            </div>
          ) : (
            log.map((e, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-2 p-2 rounded-md border border-border/50 text-xs"
              >
                <Badge variant="outline">{reasonLabel[e.reason]}</Badge>
                <div className="font-mono">
                  {e.oldVersion} <span className="text-muted-foreground">→</span> {e.newVersion}
                </div>
                <div className="text-muted-foreground">
                  {new Date(e.at).toLocaleString("ar-EG")}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default UpdateLogPanel;
