import { ReactNode, useEffect, useRef } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  section: "marketing" | "lab-treasury";
  children: ReactNode;
}

// Arabic keywords that indicate a write / mutating action.
// Buttons whose visible text matches any of these are hidden in view-only mode.
const WRITE_PATTERNS = [
  "إضافة", "أضف", "اضافة", "اضف", "جديد", "جديدة",
  "تعديل", "عدل", "تحرير",
  "حذف", "إزالة", "ازالة", "مسح",
  "حفظ", "احفظ",
  "اعتماد", "موافقة", "وافق", "رفض", "ارفض",
  "إرسال", "ارسال", "أرسل", "ارسل",
  "تسجيل", "سجل",
  "تسوية", "سوّي", "سوي",
  "تحويل", "حوّل",
  "مصروف", "إيراد", "ايراد",
  "استيراد", "رفع",
  "تأكيد", "تاكيد", "أكد", "اكد",
  "إلغاء الاعتماد", "الغاء الاعتماد",
];

// Buttons/links whose text matches these are SAFE (never hidden), even inside
// view-only mode. These are read-only navigation, print, export, filter, etc.
const SAFE_PATTERNS = [
  "طباعة", "طبع",
  "تصدير", "تنزيل", "تحميل",
  "excel", "pdf", "csv",
  "بحث", "تصفية", "فلتر",
  "عرض", "استعراض", "تفاصيل",
  "إغلاق", "اغلاق", "إلغاء", "الغاء", "رجوع", "عودة",
  "السابق", "التالي", "التالى",
  "تحديث", "إعادة تحميل", "اعادة تحميل",
];

function textOf(el: Element): string {
  const t = (el.textContent || "").trim().toLowerCase();
  const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
  return `${t} ${aria}`;
}

function isSafeControl(el: Element): boolean {
  const s = textOf(el);
  if (!s) return true; // no readable text → likely a nav/icon control; keep
  return SAFE_PATTERNS.some((p) => s.includes(p.toLowerCase()));
}

function isWriteControl(el: Element): boolean {
  // Explicit submit → treat as write
  if (el instanceof HTMLButtonElement && el.type === "submit") return true;
  if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "reset")) return true;
  const s = textOf(el);
  if (!s) return false;
  return WRITE_PATTERNS.some((p) => s.includes(p.toLowerCase()));
}

export default function ViewOnlySection({ section, children }: Props) {
  const { roles } = useAuth();
  const rootRef = useRef<HTMLDivElement>(null);

  const editorRoles: string[] =
    section === "marketing"
      ? ["general_manager", "executive_manager", "marketing_sales_manager", "social_media_manager"]
      : ["general_manager", "executive_manager", "accountant", "financial_manager",
         "lab_treasury_keeper", "lab_treasury_approver", "slaughterhouse_manager",
         "slaughterhouse_custody_keeper", "lab_external_collector"];

  const viewerRole = section === "marketing" ? "marketing_sales_viewer" : "lab_treasury_viewer";
  const hasEditor = roles.some((r) => editorRoles.includes(r));
  const hasViewer = roles.includes(viewerRole as any);
  const isViewOnly = hasViewer && !hasEditor;

  useEffect(() => {
    if (!isViewOnly || !rootRef.current) return;
    const root = rootRef.current;

    const apply = () => {
      const controls = root.querySelectorAll<HTMLElement>(
        'button, a[role="button"], [role="menuitem"], input[type="submit"], input[type="reset"]'
      );
      controls.forEach((el) => {
        if (el.dataset.viewOnlyProcessed === "1") return;
        if (isSafeControl(el)) return;
        if (isWriteControl(el)) {
          el.style.display = "none";
          el.setAttribute("aria-hidden", "true");
          el.dataset.viewOnlyProcessed = "1";
        }
      });
    };

    apply();
    const mo = new MutationObserver(() => apply());
    mo.observe(root, { childList: true, subtree: true });

    // Safety net: friendly toast for any surviving write click
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("button, a[role='button'], input[type='submit']") as HTMLElement | null;
      if (!btn) return;
      if (isSafeControl(btn)) return;
      if (!isWriteControl(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      toast.error("ليس لديك صلاحية لتنفيذ هذا الإجراء. حسابك لديه صلاحية عرض فقط في هذا القسم.");
    };
    root.addEventListener("click", onClick, true);

    return () => {
      mo.disconnect();
      root.removeEventListener("click", onClick, true);
    };
  }, [isViewOnly, section]);

  if (!isViewOnly) return <>{children}</>;

  return (
    <div ref={rootRef} className="view-only-mode" dir="rtl">
      <div className="sticky top-0 z-40 mx-2 mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 shadow-sm flex items-center gap-2 text-amber-900">
        <Eye className="w-4 h-4" />
        <span className="text-sm font-semibold">وضع العرض فقط</span>
        <span className="text-xs text-amber-800">
          — يمكنك تصفح البيانات والتقارير، لكن لا يمكنك الإضافة أو التعديل أو الحذف.
        </span>
      </div>
      {children}
    </div>
  );
}
