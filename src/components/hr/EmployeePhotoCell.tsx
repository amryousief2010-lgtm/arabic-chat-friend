import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  employeeId: string;
  name: string;
  photoPath: string | null;
  url: string | null;
  canManage: boolean;
  onChanged: () => void | Promise<void>;
}

const MAX_SIZE = 5 * 1024 * 1024;

/** صورة الموظف + رفع/حذف (للمدير العام فقط) */
const EmployeePhotoCell = ({ employeeId, name, photoPath, url, canManage, onChanged }: Props) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

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
      const path = `hr/${employeeId}/photo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;

      const { error: dbErr } = await (supabase as any)
        .from("hr_employees")
        .update({ photo_url: path })
        .eq("id", employeeId);
      if (dbErr) throw dbErr;

      await onChanged();
      toast.success(`تم تحديث صورة ${name}`);
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
        .from("hr_employees")
        .update({ photo_url: null })
        .eq("id", employeeId);
      if (error) throw error;
      if (photoPath) await supabase.storage.from("avatars").remove([photoPath]);
      await onChanged();
      toast.success("تم حذف الصورة");
    } catch (e: any) {
      toast.error(e?.message || "تعذّر حذف الصورة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Avatar className="w-9 h-9">
        {url && <AvatarImage src={url} alt={name} className="object-cover" />}
        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
          {(name || "م").trim().charAt(0)}
        </AvatarFallback>
      </Avatar>
      {canManage && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(ev) => {
              const f = ev.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="w-7 h-7"
            disabled={busy}
            title="رفع/تغيير صورة الموظف"
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          </Button>
          {photoPath && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-destructive"
              disabled={busy}
              title="حذف الصورة"
              onClick={handleRemove}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </>
      )}
    </div>
  );
};

export default EmployeePhotoCell;
