import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EMBEDDED_SIGNUP_CONFIG_ENV,
  type EmbeddedSignupLoginResult,
  type EmbeddedSignupSession,
  buildEmbeddedSignupLoginOptions,
  isFacebookMessageOrigin,
  loadFacebookSdk,
  loginResultFromResponse,
  parseEmbeddedSignupMessage,
  resolveEmbeddedSignupConfigId,
} from "@/lib/waEmbeddedSignup";

const LAUNCH_LABEL = "ربط رقم واتساب بيزنس (QR)";

function presence(value: boolean | null): string {
  if (value === null) return "لم تُجرَ المحاولة بعد";
  return value ? "نعم" : "لا";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-left break-all" dir="ltr">{value}</span>
    </div>
  );
}

const WaOnboard = () => {
  const [searchParams] = useSearchParams();
  const resolved = useMemo(
    () => resolveEmbeddedSignupConfigId(import.meta.env.VITE_META_ES_CONFIG_ID, searchParams),
    [searchParams],
  );
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [login, setLogin] = useState<EmbeddedSignupLoginResult | null>(null);
  const [sessions, setSessions] = useState<EmbeddedSignupSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadFacebookSdk()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSdkError(error instanceof Error ? error.message : "تعذر تحميل Facebook SDK");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isFacebookMessageOrigin(event.origin)) return;
      const session = parseEmbeddedSignupMessage(event.data);
      if (!session) return;
      setSessions((current) => [session, ...current].slice(0, 20));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const latest = sessions[0] ?? null;
  const canLaunch = Boolean(resolved.configId) && sdkReady;

  const launch = () => {
    if (!resolved.configId || !window.FB) return;
    try {
      window.FB.login((response) => {
        setLogin(loginResultFromResponse(response));
      }, buildEmbeddedSignupLoginOptions(resolved.configId));
    } catch (error) {
      setSdkError(error instanceof Error ? error.message : "تعذر فتح نافذة الربط");
    }
  };

  return (
    <div dir="rtl" className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">ربط رقم واتساب بيزنس</h1>
        <p className="text-muted-foreground">
          يفتح نافذة Meta لربط رقم موجود على تطبيق واتساب بيزنس عبر رمز QR
          (وضع coexistence). اختاري محفظة الأعمال 1363470494163344، ثم امسحي الرمز من
          التطبيق: الإعدادات ← منصة الأعمال.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>بدء الربط</CardTitle>
          <CardDescription>
            معرف التطبيق 1732339851839711. معرف الإعداد يُقرأ من{" "}
            <span className="font-mono" dir="ltr">{EMBEDDED_SIGNUP_CONFIG_ENV}</span>
            {" "}أو من <span className="font-mono" dir="ltr">?config_id=</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={sdkReady ? "default" : "outline"}>
              {sdkReady ? "Facebook SDK جاهز" : sdkError ? "تعذر تحميل SDK" : "جارٍ تحميل Facebook SDK"}
            </Badge>
            <Badge variant={resolved.configId ? "secondary" : "outline"}>
              {resolved.configId
                ? `config_id ${resolved.configId} من ${resolved.source === "query" ? "الرابط" : "البيئة"}`
                : "لا يوجد config_id"}
            </Badge>
          </div>

          {resolved.invalidQuery && (
            <Alert variant="destructive">
              <AlertTitle>config_id في الرابط غير صالح</AlertTitle>
              <AlertDescription>
                المعرف يجب أن يكون أرقاماً فقط. لم يُستخدم هذا الرابط لفتح النافذة.
              </AlertDescription>
            </Alert>
          )}

          {!resolved.configId && (
            <Alert>
              <AlertTitle>مطلوب معرف إعداد Embedded Signup</AlertTitle>
              <AlertDescription>
                أضيفي {EMBEDDED_SIGNUP_CONFIG_ENV} في بيئة Vercel ثم أعيدي البناء، أو افتحي
                الصفحة مع ?config_id= بعد إنشائه من Facebook Login for Business.
              </AlertDescription>
            </Alert>
          )}

          {sdkError && (
            <Alert variant="destructive">
              <AlertTitle>Facebook SDK</AlertTitle>
              <AlertDescription>{sdkError}</AlertDescription>
            </Alert>
          )}

          <Button type="button" size="lg" onClick={launch} disabled={!canLaunch}>
            {LAUNCH_LABEL}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>النتيجة</CardTitle>
          <CardDescription>
            رمز التفويض لا يُعرض ولا يُحفظ. ظهوره هنا يعني فقط أن Meta أرجعته.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field label="نجحت نافذة FB.login" value={presence(login ? login.succeeded : null)} />
          <Field label="رمز التفويض موجود" value={presence(login ? login.codePresent : null)} />
          <Field label="حالة FB.login" value={login?.status ?? "—"} />
          <Field label="الحدث" value={latest?.event ?? "—"} />
          <Field label="waba_id" value={latest?.wabaId ?? "—"} />
          <Field label="phone_number_id" value={latest?.phoneNumberId ?? "—"} />
          <Field
            label="الخطأ"
            value={
              latest?.errorMessage || latest?.errorCode
                ? [latest.errorCode, latest.errorMessage].filter(Boolean).join(" — ")
                : "—"
            }
          />
          {latest?.currentStep && <Field label="الخطوة عند الإلغاء" value={latest.currentStep} />}
          {latest?.sessionId && <Field label="session_id" value={latest.sessionId} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>سجل الجلسة</CardTitle>
          <CardDescription>أحداث WA_EMBEDDED_SIGNUP الواردة من facebook.com فقط.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3" aria-live="polite">
          {sessions.length === 0 ? (
            <p className="text-muted-foreground">لا توجد أحداث بعد.</p>
          ) : (
            sessions.map((session, index) => (
              <div key={`${session.event}-${session.wabaId ?? ""}-${index}`} className="rounded-md border p-3 text-sm">
                <div className="font-medium" dir="ltr">{session.event}</div>
                <div className="mt-1 text-muted-foreground" dir="ltr">
                  waba_id: {session.wabaId ?? "—"} · phone_number_id: {session.phoneNumberId ?? "—"}
                  {(session.errorCode || session.errorMessage) && (
                    <> · error: {[session.errorCode, session.errorMessage].filter(Boolean).join(" ")}</>
                  )}
                  {session.currentStep && <> · step: {session.currentStep}</>}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WaOnboard;
