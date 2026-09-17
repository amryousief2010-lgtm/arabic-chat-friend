import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { refreshAvatars } from "@/hooks/useAvatars";
import { toast } from "sonner";

interface Props {
  userId: string;
  userName?: string | null;
  /** يوجد صورة حالية؟ لإظهار زر الحذف */
  hasAvatar?: boolean;
}

const MAX_SIZE = 5 * 1024 * 1024;

/** زر رفع/تغيير الصورة الشخصية — يظهر للمدير العام فقط */
const AvatarUploadButton = ({ userId, userName, hasAvatar }: Props) => {
  const { isGeneralManager } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  if (!isGeneralManager) return null;

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("الملف ليس صورة");
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error("حجم الصورة أكبر من 5 ميجا");
      return;
    }
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${userId}/avatar-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { error: dbErr } = await (supabase as any)
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", userId);
      if (dbErr) throw dbErr;

      await refreshAvatars();
      toast.success(`تم تحديث صورة ${userName || "المستخدم"}`);
    } catch (e: any) {
      toast.error(e?.message || "تعذّر رفع الصورة");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any)
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", userId);
      if (error) throw error;
      await refreshAvatars();
      toast.success("تم حذف الصورة");
    } catch (e: any) {
      toast.error(e?.message || "تعذّر حذف الصورة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="w-8 h-8"
        disabled={busy}
        title="رفع/تغيير الصورة الشخصية"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
      </Button>
      {hasAvatar && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="w-8 h-8 text-destructive"
          disabled={busy}
          title="حذف الصورة"
          onClick={handleRemove}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
};

export default AvatarUploadButton;
