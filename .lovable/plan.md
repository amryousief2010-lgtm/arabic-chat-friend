## المطلوب
تعديل نظام موافقة الأوردر المكرر ليصبح **موافقة مزدوجة** (المهندسة آلاء حامد + المدير التنفيذي) بدلاً من موافقة فردية، ثم اختبار عملي كامل بحساب آية ثم منال.

## التغييرات

### 1. قاعدة البيانات
- إضافة أعمدة على `duplicate_order_approvals`:
  - `marketing_decision` (pending/approved/rejected) + `marketing_decided_by` + `marketing_decided_at` + `marketing_reason`
  - `executive_decision` (pending/approved/rejected) + `executive_decided_by` + `executive_decided_at` + `executive_reason`
- الحقل `status` يظل نهائي: `pending` → `approved` (لما الاتنين يوافقوا) / `rejected` (لأول رفض).
- تعديل RPC `decide_duplicate_order_approval` بحيث:
  - يحدد دور المستخدم (marketing_sales_manager أو executive_manager) ويحدّث الخانة المناسبة فقط.
  - لو الاتنين approved → يحدث `status='approved'`.
  - لو أي واحد rejected → `status='rejected'` فوراً.
- تعديل RLS: السماح للـ `executive_manager` بالـ SELECT/UPDATE على الجدول.
- تعديل trigger `enforce_duplicate_order_approval` بحيث يقبل الأوردر فقط لما `status='approved'` (نفس السلوك الحالي، ما يحتاجش تغيير).
- إشعارات: عند إنشاء الطلب يبعت للاتنين. عند اعتماد واحد يبعت للتاني إشعار "مستني اعتمادك".

### 2. الواجهة
- `src/pages/DuplicateOrderApprovals.tsx`: عرض خانتين منفصلتين (موافقة التسويق / موافقة التنفيذي) مع تلوين واضح، وإخفاء زر الاعتماد للـ role اللي وافق بالفعل.
- `src/pages/NewOrder.tsx`: تحديث نص الحوار للبنت ليقول "بانتظار موافقة آلاء حامد والمدير التنفيذي معاً".

### 3. الاختبار العملي (Playwright)
- Login بحساب آية → إنشاء عميل تجريبي + أوردر.
- Logout ثم Login بحساب منال → محاولة إنشاء نفس الأوردر → يجب أن يظهر Dialog التكرار.
- إرسال طلب الموافقة.
- Login بحساب آلاء → الموافقة → التحقق أن الأوردر ما زال معلقاً.
- Login بحساب المدير التنفيذي → الموافقة → التحقق أن الأوردر انتقل لـ approved.
- سيناريو رفض: تكرار بأوردر مختلف واحد يرفض.

### تنبيه
- محتاج بيانات دخول للحسابات الأربعة (آية، منال، آلاء، المدير التنفيذي) عشان أقدر أعمل اختبار Playwright فعلي. لو مش متاحة، هعمل الاختبار على مستوى SQL/RPC مباشرة وأورّي النتيجة.

## الملفات المتأثرة
- Migration جديد (schema + RPC + policies + trigger)
- `src/pages/DuplicateOrderApprovals.tsx`
- `src/pages/NewOrder.tsx` (نص فقط)
- Playwright script تحت `/tmp/browser/dup-approval-e2e/`
