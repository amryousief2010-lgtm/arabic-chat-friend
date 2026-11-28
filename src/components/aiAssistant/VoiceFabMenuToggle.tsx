import { Mic, EyeOff } from "lucide-react";
import { canUseVoiceAssistant } from "@/config/voiceAssistant";
import { useAuth } from "@/hooks/useAuth";
import { useVoiceFabPreference } from "@/hooks/useVoiceFabPreference";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { BRAND } from "@/config/aiReports";

/** عنصر قائمة المستخدم: إظهار/إخفاء الزر العائم للمساعد الصوتي. */
export function VoiceFabMenuItem() {
  const { user, roles } = useAuth();
  const { hidden, setHidden } = useVoiceFabPreference(user?.id);
  if (!canUseVoiceAssistant(roles)) return null;
  return (
    <DropdownMenuItem
      data-testid="voice-fab-menu-toggle"
      className="flex items-center gap-2 font-cairo"
      onSelect={(e) => { e.preventDefault(); setHidden(!hidden); }}
    >
      {hidden ? <Mic className="w-4 h-4" style={{ color: BRAND.magenta }} /> : <EyeOff className="w-4 h-4" />}
      {hidden ? "إظهار المساعد الصوتي" : "إخفاء المساعد الصوتي"}
    </DropdownMenuItem>
  );
}

/** زر في تذييل السايدبار (سطح المكتب والموبايل). */
export function VoiceFabSidebarToggle() {
  const { user, roles } = useAuth();
  const { hidden, setHidden } = useVoiceFabPreference(user?.id);
  if (!canUseVoiceAssistant(roles)) return null;
  return (
    <button
      type="button"
      data-testid="voice-fab-sidebar-toggle"
      onClick={() => setHidden(!hidden)}
      className="sidebar-item w-full font-cairo mb-1"
    >
      {hidden ? <Mic className="w-5 h-5" style={{ color: BRAND.magenta }} /> : <EyeOff className="w-5 h-5" />}
      <span className="font-medium">{hidden ? "إظهار المساعد الصوتي" : "إخفاء المساعد الصوتي"}</span>
    </button>
  );
}
