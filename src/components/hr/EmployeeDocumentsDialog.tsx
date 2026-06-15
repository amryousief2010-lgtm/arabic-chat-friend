import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FileText, Upload, Eye, Loader2, IdCard, FileSignature, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employeeId: string;
  employeeName: string;
  onChanged?: () => void;
}

type DocType = "national_id_card" | "work_contract";

interface DocRow {
  id: string;
  document_type: DocType;
  storage_path: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  is_active: boolean;
  uploaded_at: string;
  notes: string | null;
}

const docLabel: Record<DocType, string> = {
  national_id_card: "صورة البطاقة",
  work_contract: "عقد العمل",
};

const docIcon: Record<DocType, any> = {
  national_id_card: IdCard,
  work_contract: FileSignature,
};

const BUCKET = "hr-employee-documents";
const ACCEPT = "image/jpeg,image/png,image/jpg,application/pdf";

export default function EmployeeDocumentsDialog({ open, onOpenChange, employeeId, employeeName, onChanged }: Props) {
  const { user, isGeneralManager, isExecutiveManager, roles } = useAuth();
  const canManage = isGeneralManager || isExecutiveManager || roles.includes("hr_manager");
  const canView = canManage || roles.includes("accountant") || roles.includes("financial_manager");

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadingType, setUploadingType] = useState<DocType | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("hr_employee_documents")
      .select("*")
      .eq("employee_id", employeeId)
      .order("uploaded_at", { ascending: false });
    if (error) toast.error("فشل تحميل المستندات: " + error.message);
    setDocs((data || []) as DocRow[]);
    setLoading(false);
  };

  useEffect(() => {
    if (open && canView) load();
  }, [open, employeeId]);

  const handleUpload = async (type: DocType, file: File) => {
    if (!canManage) {
      toast.error("ليس لديك صلاحية الرفع");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("حجم الملف يتجاوز 10 ميجا");
      return;
    }
    setUploadingType(type);
    try {
      // Find currently active doc of same type
      const active = docs.find((d) => d.document_type === type && d.is_active);

      // Upload new file
      const ext = file.name.split(".").pop() || "bin";
      const ts = Date.now();
      const path = `${employeeId}/${type}/${ts}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) throw upErr;

      // Deactivate previous active (keep record)
      if (active) {
        await supabase
          .from("hr_employee_documents")
          .update({
            is_active: false,
            deactivated_at: new Date().toISOString(),
            deactivated_by: user?.id,
          })
          .eq("id", active.id);

        await supabase.from("hr_audit_log").insert({
          entity_type: "hr_employee_document",
          entity_id: active.id,
          employee_id: employeeId,
          action: "replace_deactivate",
          before_data: { document_type: type, file_name: active.file_name, is_active: true } as any,
          after_data: { document_type: type, file_name: active.file_name, is_active: false } as any,
          performed_by: user?.id,
          reason: `استبدال ${docLabel[type]}`,
        });
      }

      // Insert new doc record
      const { data: newDoc, error: insErr } = await supabase
        .from("hr_employee_documents")
        .insert({
          employee_id: employeeId,
          document_type: type,
          storage_path: path,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
          uploaded_by: user?.id,
          is_active: true,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      await supabase.from("hr_audit_log").insert({
        entity_type: "hr_employee_document",
        entity_id: (newDoc as any).id,
        employee_id: employeeId,
        action: active ? "replace_upload" : "upload",
        after_data: {
          document_type: type,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        } as any,
        performed_by: user?.id,
        reason: active ? `استبدال ${docLabel[type]}` : `رفع ${docLabel[type]}`,
      });

      toast.success(`تم رفع ${docLabel[type]}`);
      await load();
      onChanged?.();
    } catch (e: any) {
      toast.error("فشل الرفع: " + (e?.message || "خطأ"));
    } finally {
      setUploadingType(null);
    }
  };

  const handleView = async (doc: DocRow) => {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(doc.storage_path, 300);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener");

      // Audit view
      await supabase.from("hr_audit_log").insert({
        entity_type: "hr_employee_document",
        entity_id: doc.id,
        employee_id: employeeId,
        action: "view",
        after_data: { document_type: doc.document_type, file_name: doc.file_name } as any,
        performed_by: user?.id,
        reason: `عرض ${docLabel[doc.document_type]}`,
      });
    } catch (e: any) {
      toast.error("فشل فتح الملف: " + (e?.message || "خطأ"));
    }
  };

  const fmtSize = (s: number | null) => {
    if (!s) return "—";
    if (s < 1024) return `${s} B`;
    if (s < 1024 * 1024) return `${(s / 1024).toFixed(1)} KB`;
    return `${(s / 1024 / 1024).toFixed(2)} MB`;
  };

  const renderSection = (type: DocType) => {
    const Icon = docIcon[type];
    const active = docs.find((d) => d.document_type === type && d.is_active);
    const history = docs.filter((d) => d.document_type === type && !d.is_active);

    return (
      <Card key={type} className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            <span className="font-semibold">{docLabel[type]}</span>
            {active ? (
              <Badge className="bg-emerald-500/15 text-emerald-700">مرفوع ✅</Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">غير مرفوع ❌</Badge>
            )}
          </div>
          {active && (
            <Button size="sm" variant="outline" onClick={() => handleView(active)}>
              <Eye className="w-4 h-4 ml-1" />
              عرض
            </Button>
          )}
        </div>

        {active && (
          <div className="text-xs text-muted-foreground space-y-0.5">
            <div>الملف: <span className="font-mono">{active.file_name}</span></div>
            <div>الحجم: {fmtSize(active.file_size)} · النوع: {active.file_type || "—"}</div>
            <div>تاريخ الرفع: {new Date(active.uploaded_at).toLocaleString("ar-EG")}</div>
          </div>
        )}

        {canManage && (
          <div>
            <Label className="text-xs text-muted-foreground">
              {active ? "استبدال (يحفظ القديم في السجل)" : "رفع ملف"} — JPG / PNG / PDF (أقصى 10MB)
            </Label>
            <Input
              type="file"
              accept={ACCEPT}
              disabled={uploadingType === type}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(type, f);
                e.target.value = "";
              }}
              className="mt-1"
            />
            {uploadingType === type && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <Loader2 className="w-3 h-3 animate-spin" /> جارٍ الرفع...
              </div>
            )}
          </div>
        )}

        {history.length > 0 && (
          <div className="pt-2 border-t">
            <button
              type="button"
              onClick={() => setShowHistory((s) => !s)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <History className="w-3 h-3" />
              {showHistory ? "إخفاء" : "عرض"} السجل ({history.length})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-1.5">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-xs bg-muted/30 px-2 py-1.5 rounded">
                    <div>
                      <div className="font-mono">{h.file_name}</div>
                      <div className="text-muted-foreground">{new Date(h.uploaded_at).toLocaleString("ar-EG")}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleView(h)}>
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>
    );
  };

  if (!canView) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>غير مصرح</DialogTitle>
            <DialogDescription>عرض مستندات الموظفين متاح للمدير العام / التنفيذي / الموارد البشرية / المحاسبين فقط.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" /> مستندات الموظف
          </DialogTitle>
          <DialogDescription>{employeeName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin ml-2" /> جارٍ التحميل...
          </div>
        ) : (
          <div className="space-y-4">
            {renderSection("national_id_card")}
            {renderSection("work_contract")}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
