import { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * PWA Update Prompt
 * Shows a banner when a new app version is available.
 * Uses VitePWA virtual module for update events.
 */
const PWAUpdatePrompt = () => {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const promptUser = () => {
      setShowPrompt(true);
    };

    // Listen for the vite-pwa update event
    // @ts-expect-error VitePWA virtual module types
    if (window.__vitePWA__) {
      // @ts-expect-error
      window.__vitePWA__.onNeedRefresh = promptUser;
      // @ts-expect-error
      window.__vitePWA__.onOfflineReady = () => {
        console.log('[PWA] App is ready for offline use');
      };
    }

    // Also listen via the standard event for custom triggers
    window.addEventListener('vite-pwa:update-available', promptUser);

    // Periodic check for updates every 5 minutes (for mobile active sessions)
    const interval = setInterval(() => {
      // @ts-expect-error
      if (window.__vitePWA__?.updateServiceWorker) {
        // @ts-expect-error
        window.__vitePWA__.updateServiceWorker(true);
      }
    }, 5 * 60 * 1000);

    return () => {
      window.removeEventListener('vite-pwa:update-available', promptUser);
      clearInterval(interval);
    };
  }, []);

  const handleUpdate = async () => {
    setShowPrompt(false);
    // Trigger service worker update
    // @ts-expect-error VitePWA virtual module
    if (window.__vitePWA__?.updateServiceWorker) {
      // @ts-expect-error
      await window.__vitePWA__.updateServiceWorker(true);
    }
    // Hard reload after a brief delay to ensure new assets are fetched
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-primary text-primary-foreground shadow-lg animate-in slide-in-from-top duration-300">
      <div className="flex items-center justify-between px-4 py-3 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <div className="flex flex-col">
            <span className="font-semibold text-sm">تحديث جديد متاح</span>
            <span className="text-xs opacity-90">اضغط "تحديث" للحصول على آخر التغييرات</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PWAUpdatePrompt;
