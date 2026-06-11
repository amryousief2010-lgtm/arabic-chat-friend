## لوحة "اعتمادات مطلوبة" للمدير التنفيذي

شاشة موحّدة تظهر تلقائيًا أول ما يفتح المدير التنفيذي (أو المدير العام) السيستم، تجمع كل الاعتمادات المعلّقة من كل الأقسام، مع تحديث تلقائي وزر اعتماد/رفض داخل اللوحة.

### مكان الظهور
- إضافة مكوّن `ExecutiveApprovalsAlert` داخل `DashboardLayout.tsx` فوق المحتوى (بنفس نمط `PendingApprovalsAlert` الموجود حاليًا للمعمل).
- يظهر فقط لـ `executive_manager` أو `general_manager`.
- جرس عائم في الأعلى يحمل عداد ("لديك N اعتماد بانتظار المراجعة"). أول دخول في الجلسة → فتح تلقائي للّوحة. بعد الإغلاق تظل الفقاعة ظاهرة مع العداد.
- لا أي عنصر جديد في السايد بار.

### مصادر البيانات (المؤكدة في الكود/الـ DB)

| التبويب | الجدول | شرط pending | جدول الـAudit |
|---|---|---|---|
| الخزن (الرئيسية) | `main_treasury_transactions` | `status='pending_approval'` | `main_treasury_audit_log` |
| الخزن (تحويلات) | `treasury_transfers` + `treasury_transfer_settlements` | `status='pending'` | `treasury_transfer_audit_log` |
| المعمل | `lab_treasury_movements` | `status='pending'` | `lab_treasury_audit_log` |
| مصنع اللحوم | `meat_manufacturing_invoices` + `meat_factory_manufacturing` | `status='draft'` | `manager_review_audit` |
| تقسيمة الدبح | `slaughter_custody_expenses` | `status IN ('pending_review','over_limit_pending')` | `slaughter_custody_audit` |

ملاحظات صريحة من الفحص:
- جداول `feed_factory_treasury_txns` / `hatchery_treasury_txns` / `meat_factory_treasury_txns` / `mf_treasury` **ليس فيها عمود status** — هي journals مباشرة بدون اعتماد، فلن تظهر في اللوحة.
- جدول `slaughter_batches` نفسه ليس فيه حالة "بانتظار الاعتماد" — أقرب طابور اعتماد فعلي للدبح هو `slaughter_custody_expenses` (عهدة المسلخ). سيُستخدم كتبويب "تقسيمة/عهدة الدبح".
- توريد التفريخ → ينتهي بـ row في `lab_treasury_movements` بحالة pending → يظهر تلقائيًا في تبويب المعمل.

### التبويبات
`الكل (N) | الخزن (n) | مصنع اللحوم (n) | عهدة الدبح (n) | المعمل (n)` — كل تبويب يعرض عدّاد.

كل كارت يحتوي على: النوع، الخزنة/المخزن/الفاتورة، المبلغ/الكمية، المستخدم المُسجِّل، التاريخ، الحالة، أزرار **عرض التفاصيل / اعتماد / رفض** (الرفض يفتح مربع لكتابة السبب).

### الاعتماد والرفض
- يستخدم نفس RPC/منطق الاعتماد القائم في كل قسم (بدون تغيير منطق الاعتماد الحالي):
  - الخزنة الرئيسية: تحديث `status='approved'/'rejected'` + كتابة في `main_treasury_audit_log`.
  - تحويلات الخزنة: تحديث الحالة + `treasury_transfer_audit_log`.
  - المعمل: عبر hook `useLabTreasuryApprovals` الموجود.
  - فواتير تصنيع اللحوم: تحديث `status='approved'` + `approved_by/at` + `manager_review_audit` (الـ trigger الحالي يخصم الخامات ويضيف المنتج).
  - عهدة الدبح: تحديث الحالة + `slaughter_custody_audit`.
- منع التكرار: قبل أي اعتماد نتحقق من الحالة الحالية في DB؛ إذا تغيّرت تظهر رسالة "تم التعامل مع هذا الطلب بالفعل" ويُعاد تحميل القائمة.

### التحديث التلقائي
- React Query مع `refetchInterval: 30s` + `refetchOnWindowFocus`.
- Realtime subscription على الجداول الخمسة عند توفّرها في `supabase_realtime` (إن لم تكن مفعّلة، migration بسيط لإضافتها).
- العداد يتحدث فورًا. إذا ظهر طلب جديد بينما اللوحة مغلقة → toast: "يوجد اعتماد جديد بانتظارك".

### الصلاحية
- اللوحة + كل الـ RPCs محميّة بـ `has_role(auth.uid(),'executive_manager')` أو `general_manager` (السياسات الحالية بالفعل تسمح لهذين الدورين).

### الملفات

ملفات جديدة:
```
src/hooks/useExecutiveApprovals.tsx          # يجمع 5 queries + counts
src/components/executive/ExecutiveApprovalsAlert.tsx  # الجرس + الفقاعة + auto-open
src/components/executive/ExecutiveApprovalsDialog.tsx # الـDialog بالتبويبات
src/components/executive/cards/TreasuryApprovalCard.tsx
src/components/executive/cards/TransferApprovalCard.tsx
src/components/executive/cards/LabMovementApprovalCard.tsx
src/components/executive/cards/MeatInvoiceApprovalCard.tsx
src/components/executive/cards/CustodyExpenseApprovalCard.tsx
src/components/executive/RejectReasonDialog.tsx
```

ملف معدّل:
```
src/components/layout/DashboardLayout.tsx    # حقن <ExecutiveApprovalsAlert/>
```

Migration (اختياري حسب الحاجة):
```
supabase/migrations/*_realtime_exec_approvals.sql
  ALTER PUBLICATION supabase_realtime ADD TABLE <جداول الخمسة إن لم تكن مضافة>;
```

### خارج النطاق (للتأكيد)
1. لن أضيف عمود `status` لجداول `feed_factory_treasury_txns`/`hatchery_treasury_txns`/`meat_factory_treasury_txns` — هي ledgers append-only. لو محتاج اعتماد عليها لازم تصميم منفصل.
2. لن أضيف حالة اعتماد جديدة لـ `slaughter_batches` — استخدمت `slaughter_custody_expenses` كأقرب طابور موجود فعلاً. لو المقصود اعتماد التقسيمة نفسها بعد الدبح، يحتاج migration وتصميم لاحق.

هل أبدأ التنفيذ بهذا النطاق؟