import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface EnvRow {
  name: string;
  value: string | undefined;
  sensitive?: boolean;
}

const Debug = () => {
  const env = import.meta.env;

  const rows: EnvRow[] = [
    { name: "VITE_SUPABASE_URL", value: env.VITE_SUPABASE_URL },
    { name: "VITE_SUPABASE_PUBLISHABLE_KEY", value: env.VITE_SUPABASE_PUBLISHABLE_KEY, sensitive: true },
    { name: "VITE_SUPABASE_PROJECT_ID", value: env.VITE_SUPABASE_PROJECT_ID },
  ];

  const mode = env.MODE;
  const isProd = env.PROD;
  const isDev = env.DEV;

  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const fullUrl = typeof window !== "undefined" ? window.location.href : "";

  const detectEnvLabel = () => {
    if (host.includes("id-preview--")) return { label: "Preview (Lovable)", color: "secondary" as const };
    if (host.includes("lovable.app")) return { label: "Production (Lovable)", color: "default" as const };
    if (host.includes("vercel.app")) return { label: "Vercel", color: "default" as const };
    if (host.includes("netlify.app")) return { label: "Netlify", color: "default" as const };
    if (host === "localhost" || host === "127.0.0.1") return { label: "Local Dev", color: "outline" as const };
    return { label: host || "Unknown", color: "outline" as const };
  };

  const envLabel = detectEnvLabel();

  const [pingStatus, setPingStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [pingError, setPingError] = useState<string>("");

  const pingBackend = async () => {
    setPingStatus("loading");
    setPingError("");
    try {
      const { error } = await supabase.from("profiles").select("id").limit(1);
      if (error) throw error;
      setPingStatus("ok");
    } catch (e: any) {
      setPingStatus("error");
      setPingError(e?.message || "Unknown error");
    }
  };

  useEffect(() => {
    pingBackend();
  }, []);

  const mask = (v?: string) => {
    if (!v) return "—";
    if (v.length <= 12) return v;
    return `${v.slice(0, 8)}…${v.slice(-6)} (length: ${v.length})`;
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "تم النسخ", description: label });
  };

  return (
    <div dir="rtl" className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold text-foreground">صفحة التشخيص (Debug)</h1>
            <p className="text-muted-foreground mt-1">حالة متغيرات البيئة والاتصال بالـ Backend</p>
          </div>
          <Badge variant={envLabel.color} className="text-sm py-1 px-3">{envLabel.label}</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>معلومات البيئة الحالية</CardTitle>
            <CardDescription>التطبيق يعمل حالياً على هذا الرابط</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-muted/50">
              <div className="text-sm break-all">
                <div className="text-muted-foreground text-xs mb-1">URL</div>
                <code>{fullUrl}</code>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="icon" variant="outline" onClick={() => copy(fullUrl, "تم نسخ الرابط")}>
                  <Copy className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="outline" onClick={() => window.open(fullUrl, "_blank")}>
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">MODE</div>
                <div className="font-mono mt-1">{mode}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">PROD</div>
                <div className="font-mono mt-1">{String(isProd)}</div>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <div className="text-muted-foreground text-xs">DEV</div>
                <div className="font-mono mt-1">{String(isDev)}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>متغيرات Supabase (VITE_SUPABASE_*)</CardTitle>
            <CardDescription>تأكد أن جميعها محملة في بيئة الإنتاج</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((r) => {
              const loaded = !!r.value;
              return (
                <div key={r.name} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-semibold">{r.name}</code>
                      {loaded ? (
                        <Badge variant="default" className="bg-green-600 hover:bg-green-600">✅ محمّل</Badge>
                      ) : (
                        <Badge variant="destructive">❌ مفقود</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono break-all">
                      {loaded ? (r.sensitive ? mask(r.value) : r.value) : "غير معرّف"}
                    </div>
                  </div>
                  {loaded && (
                    <Button size="icon" variant="outline" onClick={() => copy(r.value!, `تم نسخ ${r.name}`)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>اختبار الاتصال بالـ Backend</CardTitle>
              <CardDescription>طلب فعلي على جدول profiles</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={pingBackend} disabled={pingStatus === "loading"}>
              <RefreshCw className={`w-4 h-4 ml-2 ${pingStatus === "loading" ? "animate-spin" : ""}`} />
              إعادة الفحص
            </Button>
          </CardHeader>
          <CardContent>
            {pingStatus === "loading" && <Badge variant="outline">جاري الاختبار...</Badge>}
            {pingStatus === "ok" && <Badge className="bg-green-600 hover:bg-green-600">✅ الاتصال يعمل</Badge>}
            {pingStatus === "error" && (
              <div className="space-y-2">
                <Badge variant="destructive">❌ فشل الاتصال</Badge>
                <p className="text-sm text-destructive font-mono break-all">{pingError}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>روابط البيئات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: "Production (Lovable)", url: "https://arabic-chat-friend.lovable.app/debug" },
              { label: "Preview (Lovable)", url: "https://id-preview--fc850134-69bc-4f36-9218-2558ebfb15c0.lovable.app/debug" },
            ].map((l) => (
              <div key={l.url} className="flex items-center justify-between gap-3 p-3 rounded-lg border">
                <div>
                  <div className="font-semibold text-sm">{l.label}</div>
                  <code className="text-xs text-muted-foreground break-all">{l.url}</code>
                </div>
                <Button size="sm" variant="outline" onClick={() => window.open(l.url, "_blank")}>
                  <ExternalLink className="w-4 h-4 ml-1" />
                  فتح
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Debug;
