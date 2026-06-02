import { Component, ReactNode } from "react";

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * يلتقط أخطاء render القاتلة (مثل فشل تحميل chunk قديم بعد نشر تحديث)
 * ويعرض شاشة فيها زر إعادة تحميل قوي بدلاً من شاشة بيضاء فارغة.
 */
class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[AppErrorBoundary]", error);
    // فشل تحميل chunk = نسخة قديمة عالقة في الكاش، نحاول الإنعاش التلقائي مرة واحدة
    const msg = String(error?.message || "");
    const isChunkError =
      msg.includes("Failed to fetch dynamically imported module") ||
      msg.includes("Loading chunk") ||
      msg.includes("Importing a module script failed") ||
      msg.includes("Unexpected token '<'");
    if (isChunkError && !sessionStorage.getItem("__chunk_recover")) {
      sessionStorage.setItem("__chunk_recover", "1");
      this.hardReload();
    }
  }

  hardReload = async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch {
      // ignore
    }
    const url = new URL(window.location.href);
    url.searchParams.set("_v", String(Date.now()));
    window.location.replace(url.toString());
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        dir="rtl"
        className="min-h-screen flex items-center justify-center bg-background p-4"
      >
        <div className="max-w-md w-full bg-card border border-border rounded-2xl shadow-xl p-6 text-center space-y-4">
          <div className="text-5xl">⚠️</div>
          <h1 className="text-xl font-bold text-foreground">
            تعذّر تحميل الصفحة
          </h1>
          <p className="text-sm text-muted-foreground">
            قد يكون السبب نسخة قديمة محفوظة في المتصفح بعد نشر تحديث جديد.
            اضغط الزر بالأسفل لإعادة التحميل بشكل كامل.
          </p>
          <button
            onClick={this.hardReload}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-orange-500 px-5 py-2.5 text-sm font-bold text-white hover:opacity-90 transition-opacity w-full"
          >
            🔄 تحديث الصفحة بالكامل
          </button>
          {this.state.error?.message && (
            <p className="text-[10px] text-muted-foreground/60 font-mono break-all">
              {this.state.error.message}
            </p>
          )}
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
