import { useEffect, useCallback, useRef } from 'react';

const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const CHECK_INTERVAL_MS = 60 * 1000; // كل دقيقة
const RELOAD_GUARD_KEY = 'auto-update-reloading';

const PWAUpdatePrompt = () => {
  const updatingRef = useRef(false);

  const performAutoUpdate = useCallback(async () => {
    if (updatingRef.current) return;
    updatingRef.current = true;

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

    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    // إعادة تحميل صامتة فورية
    window.location.reload();
  }, []);

  const checkForUpdate = useCallback(async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { version?: string };
      const remote = data?.version;
      if (!remote || remote === CURRENT_VERSION) {
        sessionStorage.removeItem(RELOAD_GUARD_KEY);
        return;
      }
      // تجنب حلقة إعادة التحميل لو الإصدار الجديد لم ينتشر بعد
      if (sessionStorage.getItem(RELOAD_GUARD_KEY) === '1') return;
      await performAutoUpdate();
    } catch {
      // network errors silent
    }
  }, [performAutoUpdate]);

  useEffect(() => {
    checkForUpdate();
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkForUpdate();
    };
    const onFocus = () => checkForUpdate();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkForUpdate]);

  return null;
};

export default PWAUpdatePrompt;
