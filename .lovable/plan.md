# خطة: قسم "الحساب البنكي" داخل الخزنة الرئيسية

النظام الحالي عنده جدول `main_treasury_accounts` بيدعم نوع `bank` بالفعل، وجدول `main_treasury_transactions` بحركات معتمدة (deposit / withdrawal / expense / transfer_to_custody / adjustment) مع موافقة وحماية بعد الاعتماد و audit log. هنبني فوق ده **بدون حذف** أي بيانات أو صلاحيات.

## ١. قاعدة البيانات (migration واحد)

**جدول جديد:** `main_treasury_bank_categories` (بنود مصاريف خاصة بالحساب البنكي)
- code, label, requires_attachment (bool), notes, is_active, sort_order
- seed: قسط قرض / رسوم بنكية / مصاريف تحويل / عمولة بنك / فوائد قرض / دفتر شيكات / كشف حساب / مصاريف إدارية / أخرى

**توسيع `main_treasury_transactions`:**
- إضافة أعمدة: `bank_category_id uuid`, `loan_number text`, `bank_account_number text`, `payment_method text`, `client_uuid uuid UNIQUE` (لمنع التكرار)
- توسيع check على `txn_type` ليشمل القيم الجديدة:
  `loan_installment`, `bank_fees`, `bank_deposit`, `bank_withdrawal`, `transfer_from_custody`, `transfer_to_sub_treasury`, `settlement`, `balance_correction`

**تحديث `v_main_treasury_balance`:**
- الإيداع/الزيادة: `deposit`, `bank_deposit`, `transfer_from_custody`, `settlement` (موجب), `balance_correction`, `adjustment`
- الخصم: `withdrawal`, `expense`, `bank_withdrawal`, `bank_fees`, `loan_installment`, `transfer_to_custody`, `transfer_to_sub_treasury`

**حقل `bank_category_id`** يُستخدم فقط مع `expense / bank_fees / loan_installment`.

**Audit log:** الترايجر الموجود `main_treasury_audit_log` يكفي؛ نضيف تسجيل عند إنشاء/تعطيل بند مصروف بنكي.

## ٢. الصلاحيات

- المحاسب محمد شعلة عنده دور `main_treasury_accountant` بالفعل → يقدر يسجل ويرفع مرفقات.
- RLS قاعدة: مينفعش يعتمد حركة سجلها بنفسه (يتم enforcement في `mt_approve_txn` بشرط `created_by <> auth.uid()` — موجود غالبًا، هنتأكد ونضيفه لو ناقص).
- الاعتماد: `main_treasury_approver` + general/executive/financial manager (زي اللي موجود).

## ٣. واجهة المستخدم

داخل `src/pages/MainTreasury.tsx` نضيف تبويب جديد **"الحساب البنكي"**:

**كروت أعلى الصفحة (لكل حساب بنكي):**
- الرصيد الحالي / الافتتاحي / الإيداعات / السحوبات / المصروفات البنكية / أقساط القرض المسددة / الرسوم البنكية / الرصيد المتوقع / عدد المعلقة

**جدول الحركات البنكية** مع فلاتر: التاريخ، نوع الحركة، الحالة، بند المصروف، اسم البنك.

**أزرار:**
- "تسجيل حركة بنكية" (Dialog شامل بكل الحقول + رفع مرفق + `client_uuid` للحماية من التكرار)
- "إنشاء بند مصروف بنكي" (للمحاسب والإدارة)
- "تصدير PDF" (عبر `openPrintWindow` من `@/lib/printPdf` — Arabic RTL)
- "تصدير Excel" (عبر `xlsx` المتاحة)

**ملخّص في تبويب "نظرة عامة":**
- رصيد النقدية / رصيد البنك / الإجمالي / الحركات البنكية المعلقة / أقساط الشهر / المصروفات البنكية للشهر.

## ٤. منع التكرار

- عمود `client_uuid UNIQUE` يُولَّد بـ `crypto.randomUUID()` عند فتح الـ Dialog ويُرسل مع الإدخال؛ أي retry بنفس الـ UUID يُرفض من DB.
- زر الحفظ يُعطَّل أثناء `isSubmitting`.

## ٥. التقارير

تبويب فرعي "تقارير البنك":
- يومي / شهري / حسب بند المصروف / حسب البنك / المعلقة / أقساط القرض / المصروفات البنكية
- كل تقرير يدعم تصدير PDF و Excel.

## ٦. ملفات ستُعدَّل/تُنشأ

- migration واحد (جدول + أعمدة + توسيع check + تحديث view + seed).
- `src/pages/MainTreasury.tsx`: إضافة Tab "الحساب البنكي" + ملخص في النظرة العامة.
- `src/components/main-treasury/BankAccountPanel.tsx` (جديد)
- `src/components/main-treasury/BankTxnDialog.tsx` (جديد)
- `src/components/main-treasury/BankCategoryDialog.tsx` (جديد)
- `src/components/main-treasury/BankReports.tsx` (جديد)
- تحديث memory ملف `main-treasury.md`.

## ضمانات

- لا تُحذف أي بيانات أو صلاحيات أو حسابات.
- خزنة النقدية تظل منفصلة؛ قسط القرض/المصروفات البنكية لا تُخصم إلا من حسابات `account_type='bank'` بعد الاعتماد.
- كل الحركات تظل تحت نفس workflow الاعتماد الموجود (مع الحدّ المزدوج لو > 50,000).

أأكد وأبدأ التنفيذ؟
