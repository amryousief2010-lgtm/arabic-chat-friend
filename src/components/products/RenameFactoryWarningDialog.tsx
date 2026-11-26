import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  oldName: string;
  newName: string;
  lostItems: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

/** تحذير قبل حفظ اسم جديد لمنتج مصنّع سيفصله عن صنفه التام في مصنع اللحوم. */
export default function RenameFactoryWarningDialog({ open, oldName, newName, lostItems, onCancel, onConfirm }: Props) {
  const items = lostItems.map((n) => `«${n}»`).join("، ");
  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <AlertDialogContent dir="rtl" className="text-right font-[Cairo] max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <AlertDialogHeader className="text-right sm:text-right">
          <AlertDialogTitle className="flex items-center gap-2 text-[#662D8C]">
            <AlertTriangle className="w-5 h-5 text-[#F37346] shrink-0" />
            تنبيه قبل حفظ الاسم الجديد
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm leading-7 text-foreground">
              <p>
                تغيير اسم المنتج من <b>«{oldName}»</b> إلى <b>«{newName}»</b> سيفصله عن الصنف التام في مصنع اللحوم {items}.
              </p>
              <p>
                بعد الحفظ لن يُحوَّل إنتاج هذا الصنف من المصنع إلى المخزن الرئيسي على هذا المنتج، ولن يظهر المنتج مربوطًا بمصنع اللحوم.
              </p>
              <p className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-2">
                الأفضل: اطلب من مشرف المخازن ربط صنف المصنع بالمنتج أولًا، ثم غيّر الاسم. أو اختر اسمًا يطابق اسم صنف المصنع.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-start sm:space-x-0 sm:gap-2">
          <AlertDialogCancel onClick={onCancel} className="mt-0">رجوع وتعديل الاسم</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-[#A4288A] hover:bg-[#8e2277]">حفظ رغم ذلك</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
