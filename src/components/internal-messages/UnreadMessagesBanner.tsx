import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Mail, X } from "lucide-react";
import { useUnreadInternalMessages } from "@/hooks/useUnreadInternalMessages";

/**
 * In-app banner shown at the top of the dashboard whenever the current user
 * has unread internal messages. Reuses the same data source as the sidebar
 * counter (useUnreadInternalMessages) so they stay in sync via Realtime.
 *
 * Dismiss is per-session-only (component state). On reload/login the banner
 * shows again as long as unread > 0.
 */
const UnreadMessagesBanner = () => {
  const { unreadCount } = useUnreadInternalMessages();
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (unreadCount <= 0 || dismissed) return null;
  // Don't show on the messages pages themselves.
  if (location.pathname.startsWith("/internal-messages")) return null;

  const text =
    unreadCount === 1
      ? "لديك رسالة داخلية غير مقروءة"
      : `لديك ${unreadCount} رسائل داخلية غير مقروءة`;

  return (
    <Alert className="mb-4 border-primary/40 bg-primary/5">
      <Mail className="h-4 w-4 text-primary" />
      <AlertTitle className="text-primary">رسائل داخلية</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 mt-1">
        <span className="text-sm">{text}</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate("/internal-messages?filter=unread")}
          >
            عرض الرسائل
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDismissed(true)}
            aria-label="إخفاء"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
};

export default UnreadMessagesBanner;
