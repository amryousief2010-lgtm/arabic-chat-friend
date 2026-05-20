import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RefreshCw, AlertTriangle, Smartphone, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { checkForServiceWorkerUpdate } from "@/lib/registerSW";
import { CURRENT_VERSION, checkAndReloadIfStale, getLastCheck } from "@/lib/updateChecker";
import { formatDateTime } from "@/lib/dateFormat";

type SWState = "active" | "waiting" | "installing" | "unregistered" | "unsupported";

const ICON_PATHS = [
  { key: "favicon", path: "/favicon.png" },
  { key: "pwa192", path: "/pwa-192x192.png" },
  { key: "pwa512", path: "/pwa-512x512.png" },
  { key: "appleTouch", path: "/apple-touch-icon.png" },
];

const INSTALLED_HASHES_KEY = "pwa-installed-icon-hashes";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

const PwaDiagnostics = () => {
  const [swState, setSwState] = useState<SWState>("unsupported");
  const [swScriptUrl, setSwScriptUrl] = useState<string>("—");
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [manifestRaw, setManifestRaw] = useState<string>("");
  const [iconHashes, setIconHashes] = useState<Record<string, string>>({});
  const [serverAssets, setServerAssets] = useState<Record<string, string>>({});
  const [remoteVersion, setRemoteVersion] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState<string[]>([]);

  const refreshSW = useCallback(async () => {
    if (!("serviceWorker" in navigator)) {
      setSwState("unsupported");
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return setSwState("unregistered");
    setSwScriptUrl(reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || "—");
    if (reg.waiting) setSwState("waiting");
    else if (reg.installing) setSwState("installing");
    else if (reg.active) setSwState("active");
    else setSwState("unregistered");
  }, []);

  const fetchAll = useCallback(async () => {
    setBusy(true);
    try {
      // Manifest
      try {
        const res = await fetch("/manifest.webmanifest", { cache: "no-store" });
        const text = await res.text();
        setManifestRaw(text);
        try {
          setManifest(JSON.parse(text));
        } catch {
          setManifest(null);
        }
      } catch {
        setManifest(null);
      }

      // Version + server-side asset hashes
      try {
        const r = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
        const j = await r.json();
        setRemoteVersion(j?.version ?? null);
        setServerAssets(j?.assets ?? {});
      } catch {
        setRemoteVersion(null);
      }

      // Hash icons live from network
      const hashes: Record<string, string> = {};
      await Promise.all(
        ICON_PATHS.map(async ({ key, path }) => {
          try {
            const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
            const buf = await res.arrayBuffer();
            hashes[key] = await sha256Hex(buf);
          } catch {
            hashes[key] = "error";
          }
        }),
      );
      setIconHashes(hashes);

      await refreshSW();
    } finally {
      setBusy(false);
    }
  }, [refreshSW]);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error iOS
        window.navigator.standalone === true,
    );
    void fetchAll();
  }, [fetchAll]);

  // Compute mismatch: compare current network icon hashes vs hashes saved at install time
  useEffect(() => {
    if (!Object.keys(iconHashes).length) return;
    try {
      const stored = localStorage.getItem(INSTALLED_HASHES_KEY);
      if (!stored) {
        // First time we see hashes — remember them
        localStorage.setItem(INSTALLED_HASHES_KEY, JSON.stringify(iconHashes));
        setMismatch([]);
        return;
      }
      const prev = JSON.parse(stored) as Record<string, string>;
      const diff: string[] = [];
      for (const k of Object.keys(iconHashes)) {
        if (prev[k] && prev[k] !== iconHashes[k]) diff.push(k);
      }
      setMismatch(diff);
    } catch {
      // ignore
    }
  }, [iconHashes]);

  const resetInstalledHashes = () => {
    localStorage.setItem(INSTALLED_HASHES_KEY, JSON.stringify(iconHashes));
    setMismatch([]);
    toast.success("تم تحديث بصمة الأيقونات المثبّتة");
  };

  const forceSWUpdate = async () => {
    setBusy(true);
    try {
      const res = await checkForServiceWorkerUpdate();
      if (res === "updated") toast.success("تم تفعيل نسخة جديدة — جارٍ إعادة التحميل...");
      else if (res === "current") toast("لا توجد تحديثات جديدة");
      else toast("Service Worker غير مفعّل في هذه البيئة");
    } catch (e) {
      toast.error("فشل فحص التحديث", { description: (e as Error)?.message });
    } finally {
      setBusy(false);
      void refreshSW();
    }
  };

  const forceVersionCheck = async () => {
    setBusy(true);
    try {
      const reloaded = await checkAndReloadIfStale("manual");
      if (!reloaded) toast.success("أنت على أحدث نسخة");
    } finally {
      setBusy(false);
    }
  };

  const lastCheck = getLastCheck();

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold">تشخيص PWA</h1>
            <p className="text-muted-foreground mt-1">
              حالة Service Worker و manifest وبصمات الأيقونات
            </p>
          </div>
          <Badge variant={isStandalone ? "default" : "outline"}>
            <Smartphone className="w-3 h-3 ml-1" />
            {isStandalone ? "مثبّت كتطبيق" : "متصفح عادي"}
          </Badge>
        </div>

        {mismatch.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>اختلاف في الأيقونات المثبّتة</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                هناك اختلاف بين الأيقونات الحالية والأيقونات المسجَّلة عند التثبيت
                ({mismatch.join(", ")}). إذا كان التطبيق مثبّتاً على الشاشة الرئيسية فيجب
                <strong> حذف التطبيق المثبّت وإعادة تثبيته </strong>
                لأن iOS و Android يثبّتان الأيقونة و manifest عند التثبيت ولا يحدّثانها تلقائياً.
              </p>
              <Button size="sm" variant="outline" onClick={resetInstalledHashes}>
                لقد أعدت التثبيت — أعد ضبط البصمة
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>إجراءات سريعة</CardTitle>
            <CardDescription>تحديث Service Worker وإعادة التحقق من الإصدار</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button onClick={forceSWUpdate} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ml-2 ${busy ? "animate-spin" : ""}`} />
              تحديث Service Worker وإعادة التحميل
            </Button>
            <Button variant="outline" onClick={forceVersionCheck} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ml-2 ${busy ? "animate-spin" : ""}`} />
              فرض إعادة التحقق من الإصدار
            </Button>
            <Button variant="outline" onClick={() => void fetchAll()} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ml-2 ${busy ? "animate-spin" : ""}`} />
              إعادة فحص الأصول
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>حالة Service Worker</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between p-3 rounded-lg bg-muted/40">
              <span className="text-muted-foreground">الحالة</span>
              <Badge>{swState}</Badge>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-muted/40 gap-2">
              <span className="text-muted-foreground">السكربت</span>
              <code className="text-xs break-all">{swScriptUrl}</code>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-muted/40">
              <span className="text-muted-foreground">الإصدار المحلي</span>
              <code className="text-xs">{CURRENT_VERSION}</code>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-muted/40">
              <span className="text-muted-foreground">إصدار الخادم</span>
              <code className="text-xs">{remoteVersion ?? "—"}</code>
            </div>
            <div className="flex justify-between p-3 rounded-lg bg-muted/40">
              <span className="text-muted-foreground">آخر فحص</span>
              <code className="text-xs">{lastCheck ? formatDateTime(lastCheck.at) : "—"}</code>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>بصمات الأيقونات</CardTitle>
            <CardDescription>SHA-256 (مختصر) من النسخة الحالية على الخادم</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ICON_PATHS.map(({ key, path }) => {
              const live = iconHashes[key];
              const server = serverAssets[key];
              const ok = live && server && live === server;
              return (
                <div key={key} className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <div className="flex items-center justify-between">
                    <code className="text-xs">{path}</code>
                    {ok ? (
                      <Badge className="bg-green-600 hover:bg-green-600">
                        <CheckCircle2 className="w-3 h-3 ml-1" />
                        مطابق
                      </Badge>
                    ) : (
                      <Badge variant="outline">{server ? "مختلف" : "—"}</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">شبكة: </span>
                      <code>{live ?? "—"}</code>
                    </div>
                    <div>
                      <span className="text-muted-foreground">build: </span>
                      <code>{server ?? "—"}</code>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>manifest.webmanifest</CardTitle>
          </CardHeader>
          <CardContent>
            {manifest ? (
              <pre className="text-xs bg-muted/40 p-3 rounded-lg overflow-auto max-h-96">
                {JSON.stringify(manifest, null, 2)}
              </pre>
            ) : (
              <pre className="text-xs bg-muted/40 p-3 rounded-lg overflow-auto max-h-96">
                {manifestRaw || "تعذّر تحميل الـ manifest"}
              </pre>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PwaDiagnostics;
