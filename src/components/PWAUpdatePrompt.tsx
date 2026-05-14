import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const DISMISSED_KEY = 'pwa-update-dismissed-version';
const SNOOZE_UNTIL_KEY = 'pwa-update-snooze-until';
// Snooze for 6 hours after dismiss (still shows earlier if a brand-new version appears)
const SNOOZE_MS = 6 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const PWAUpdatePrompt = () => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const remote = data?.version;
      if (!remote || remote === CURRENT_VERSION) return;

      const dismissedVersion = localStorage.getItem(DISMISSED_KEY);
      const snoozeUntil = Number(localStorage.getItem(SNOOZE_UNTIL_KEY) || 0);

      // If user dismissed THIS exact version and snooze is still active → stay hidden
      if (dismissedVersion === remote && Date.now() < snoozeUntil) return;

      setLatestVersion(remote);
      setShowPrompt(true);
    } catch {
      // Network errors are silent
    }
  }, []);

  useEffect(() => {
    // Initial check + periodic + on visibility change
    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkForUpdate]);

  const handleUpdate = async () => {
    setShowPrompt(false);
    localStorage.removeItem(DISMISSED_KEY);
    localStorage.removeItem(SNOOZE_UNTIL_KEY);

    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }

      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs || []).map((r) => r.unregister()));
    } catch {
      // ignore
    }

    setTimeout(() => window.location.reload(), 300);
  };

  const handleDismiss = () => {
    if (latestVersion) {
      localStorage.setItem(DISMISSED_KEY, latestVersion);
      localStorage.setItem(SNOOZE_UNTIL_KEY, String(Date.now() + SNOOZE_MS));
    }
    setShowPrompt(false);
  };

  if (!showPrompt || !latestVersion) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-primary text-primary-foreground shadow-lg animate-in slide-in-from-top duration-300">
      <div className="flex items-center justify-between gap-3 px-4 py-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-3 min-w-0">
          <RefreshCw className="w-5 h-5 shrink-0 animate-spin" />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-sm">تحديث جديد متاح</span>
            <span className="text-xs opacity-90 truncate">
              الإصدار الحالي: <span dir="ltr" className="font-mono">{CURRENT_VERSION}</span>
              {' '}←{' '}
              الجديد: <span dir="ltr" className="font-mono">{latestVersion}</span>
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            onClick={handleUpdate}
            className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 font-semibold"
          >
            تحديث
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleDismiss}
            className="text-primary-foreground hover:bg-primary-foreground/20 h-8 w-8"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PWAUpdatePrompt;
