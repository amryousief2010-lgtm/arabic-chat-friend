# خطة: توريد الخزنة الرئيسية → خزنة العهدة (Double-Entry آمن)

البناء **فوق** البنية القائمة بدون حذف أو تعديل أي بيانات/صلاحيات حالية.

## ١. البنية المعتمدة (الموجودة فعلًا)
- `main_treasury_transactions` بنوع `transfer_to_custody` يخصم تلقائيًا من رصيد الخزنة الرئيسية لما `status='posted'` (موجود في `v_main_treasury_balance`).
- `mt_approve_txn` فيها: منع الاعتماد الذاتي + قاعدة الاعتماد المزدوج لو > 50,000 + المعتمدون: المدير العام/التنفيذي/المالي + `main_treasury_approver`.
- `main_treasury_to_custody_transfers` جدول الربط — موجود.
- ناقص: **زيادة رصيد خزنة العهدة** بعد الاعتماد (الـ view `v_slaughter_custody_balance` بيقرأ من `slaughter_custody_opening_balances` فقط).

## ٢. تغييرات قاعدة البيانات (migration واحد)

### (أ) عمود ربط idempotent على رصيد العهدة
```sql
ALTER TABLE slaughter_custody_opening_balances
  ADD COLUMN source_main_txn_id uuid UNIQUE
    REFERENCES main_treasury_transactions(id) ON DELETE RESTRICT;
```
وجود `UNIQUE` يمنع إنشاء سطرين لنفس التوريد حتى لو الـ trigger اتنفذ مرتين.

### (ب) Trigger يضيف للعهدة عند posted ويعكس عند reversal
- `AFTER UPDATE` على `main_treasury_transactions`:
  - لو `NEW.txn_type='transfer_to_custody' AND NEW.status='posted' AND OLD.status<>'posted'` → INSERT في `slaughter_custody_opening_balances` (status `approved`, `total_amount=NEW.amount`, `cash_amount=NEW.amount`, `as_of_date=NEW.txn_date`, `source_main_txn_id=NEW.id`, ملاحظة "توريد من الخزنة الرئيسية #ref"). يُحدِّث/يُنشِئ صف في `main_treasury_to_custody_transfers` بـ `status='received'`.
  - لو `NEW.status='reversed' AND OLD.status='posted'` → DELETE صف الـ opening المرتبط (نفس `source_main_txn_id`).
- الـ INSERT يتم تحت `SECURITY DEFINER` بدالة عشان يعدي RLS.

### (ج) Idempotency على إنشاء التوريد نفسه
- استخدام `client_uuid` الموجود فعلًا (UNIQUE) على `main_treasury_transactions` لمنع إعادة الإرسال.
- فحص duplicate منطقي: حركة `pending_approval` بنفس `txn_date + amount + recipient_name + txn_type='transfer_to_custody'` ترفع تنبيه في الـ UI قبل الإرسال.

### (د) منع التلاعب المباشر برصيد العهدة لصفوف التوريد
- منع تعديل/حذف أي صف في `slaughter_custody_opening_balances` يحمل `source_main_txn_id IS NOT NULL` من قِبَل المستخدمين العاديين (BEFORE UPDATE/DELETE trigger يرفع EXCEPTION ما عدا الـ trigger الداخلي عند reversal).

### (هـ) Audit Log
- `main_treasury_audit_log` بيسجل create/approve/reject أصلًا. نضيف entries أوتوماتيكية في الـ trigger عند `posted` و`reversed` بالنوع `custody_credit_created` و`custody_credit_reversed` (تشمل المبلغ والمستلم والـ source/target).

## ٣. واجهة المستخدم (لا حذف)

### فورم جديد: "توريد إلى خزنة العهدة"
- مكوّن `TransferToCustodyDialog.tsx` (جديد) داخل `src/components/main-treasury/`.
- الحقول المطلوبة (كلها في المواصفات): التاريخ، المبلغ، الخزنة المصدر (مقفل = الخزنة الرئيسية)، الخزنة المستلمة (مقفل = خزنة العهدة)، اسم المستلم في العهدة (Select لأمناء العهدة)، سبب التوريد، طريقة التسليم (cash/transfer/other)، مرفق إيصال (سحب وإفلات عبر `DragDropUpload` الموجود)، ملاحظات.
- يولّد `client_uuid` عند فتح الـ Dialog. زر الحفظ يُعطَّل أثناء الإرسال.
- يحفظ كـ `main_treasury_transactions(txn_type='transfer_to_custody', status='pending_approval', recipient_name, payment_method, attachment_url, client_uuid, ...)`.

### كارت في لوحة الخزنة الرئيسية
- "توريدات إلى خزنة العهدة": اليوم / الشهر / معلقة / معتمدة / مرفوضة (Query على `main_treasury_transactions` نوع `transfer_to_custody` مع cairoDate helpers).

### كارت في صفحة الخزنة العهدة (`SlaughterhouseCustody.tsx`)
- "وارد من الخزنة الرئيسية": اليوم / الشهر / معلق / معتمد / آخر توريد مستلم.

### قسم تقارير
- تبويب فرعي داخل `MainTreasury.tsx` يعرض جدول التوريدات مع فلاتر (تاريخ/الحالة/المستلم) + تصدير PDF (`openPrintWindow`) + Excel (`xlsx`).

## ٤. الصلاحيات (موجودة — تأكيد فقط)
- محمد شعلة (`main_treasury_accountant`): إنشاء التوريد ورفع المرفق ومتابعة الحالة.
- المدير العام/التنفيذي/المالي + `main_treasury_approver`: اعتماد/رفض.
- `mt_approve_txn` تمنع الاعتماد الذاتي بالفعل.
- الرفض عبر `mt_reject_txn` يحفظ السبب الإجباري.

## ٥. المعادلة المحاسبية (مضمونة بعد التغييرات)

```text
رصيد الخزنة الرئيسية = opening
                     + posted(deposit / bank_deposit / transfer_from_custody / settlement / adjustment)
                     − posted(withdrawal / expense / bank_* / loan_installment / transfer_to_custody / ...)

رصيد خزنة العهدة     = approved(opening_balances)               ← يشمل الآن صفوف التوريد المعتمدة
                     − approved(custody_expenses)
```

- `pending_approval` لا يؤثر على أي رصيد فعلي.
- العمود `pending_amount` في `v_main_treasury_balance` يظهر "الرصيد المتوقع" للمعلقة.

## ٦. منع التكرار (طبقات متعددة)

1. `client_uuid UNIQUE` يرفض الـ retry على مستوى DB.
2. زر الحفظ disabled أثناء الإرسال.
3. فحص الـ duplicate قبل الحفظ (نفس المبلغ/التاريخ/المستلم في آخر ساعة وحالة `pending_approval` أو `posted`) → تنبيه: "هذه حركة توريد مسجلة من قبل ولا يمكن تكرارها" مع زر "تأكيد الإرسال رغم ذلك".
4. عمود `source_main_txn_id UNIQUE` يضمن أن الاعتماد المتكرر لنفس الحركة لا يضاعف رصيد العهدة.
5. `mt_approve_txn` بترفض اعتماد حركة ليست `pending_approval`.

## ٧. ملفات ستُنشَأ/تُعدَّل

- **Migration واحد** (الجدول أعمدة + الـ triggers + الـ audit).
- جديد: `src/components/main-treasury/TransferToCustodyDialog.tsx`
- جديد: `src/components/main-treasury/TransfersToCustodyCard.tsx` (كارت اللوحة)
- جديد: `src/components/main-treasury/TransfersToCustodyReport.tsx` (التقرير + Excel/PDF)
- تعديل: `src/pages/MainTreasury.tsx` (إضافة الكارت + التبويب + الزر)
- تعديل: `src/pages/SlaughterhouseCustody.tsx` (كارت "وارد من الخزنة الرئيسية")
- تعديل: `.lovable/memory/features/main-treasury.md`

## ٨. ضمانات

- ❌ لا تُحذف أي بيانات أو صلاحيات أو حسابات أو policies.
- ❌ التوريد لا يُسجَّل كـ `expense` نهائيًا — هو `transfer_to_custody` فقط.
- ✅ الرصيدان لا يتأثران إلا بعد `posted` (= بعد الاعتماد، أو الاعتماد المزدوج لو > 50,000).
- ✅ الرفض = لا خصم ولا إضافة ولا صف opening.
- ✅ Reversal يمسح صف العهدة المرتبط آليًا.

أأكد وأبدأ بتنفيذ الـ migration ثم الواجهة؟