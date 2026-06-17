
## الهدف
السماح في شاشة "دفعة ذبح جديدة" باختيار أكثر من دفعة نعام كمصدر، مع خصم العدد من كل دفعة، وحساب تكلفة دقيقة قابلة للتوزيع على نواتج الذبح.

## 1) تغييرات قاعدة البيانات (Migration)
إنشاء جدول الربط الجديد:

```text
slaughter_batch_live_sources
  id                       uuid PK
  slaughter_batch_id       uuid FK → slaughter_batches(id) ON DELETE CASCADE
  live_receipt_id          uuid FK → slaughter_live_receipts(id) RESTRICT
  birds_count              int  > 0
  cost_per_bird_snapshot   numeric(14,4)   -- لقطة وقت الدبح
  total_birds_cost         numeric(14,4)   -- birds_count × snapshot
  notes                    text
  reference_id             text UNIQUE      -- slaughter_source_{batch}_{receipt}
  created_by               uuid
  created_at, updated_at   timestamptz
  UNIQUE (slaughter_batch_id, live_receipt_id)  -- منع تكرار نفس الدفعة
```

- GRANT للقراءة/الكتابة لـ `authenticated` و `ALL` لـ `service_role`.
- RLS مفعّل + سياسات بنفس صلاحيات `slaughter_batches`.
- Trigger `BEFORE INSERT` يتحقق أن `birds_count ≤ current_alive_count` للدفعة المصدر، ويخصم تلقائيًا من `slaughter_live_receipts.current_alive_count`، ويكتب سطر في `slaughter_audit_log`.
- `cost_per_bird_snapshot` تُلتقط تلقائيًا من الدفعة المصدر إن لم يحدد المستخدم قيمة.

## 2) واجهة `SlaughterBatchDialog`
- استبدال حقل "استلام حي مرتبط" الفردي بقسم **"مصادر النعام الداخل للدبح"**.
- جدول صفوف ديناميكي، كل صف:
  - Select لدفعة النعام (يستبعد الدفعات المختارة بالفعل).
  - عرض: العدد المتاح + تكلفة النعامة الحالية.
  - Input لعدد المسحوب (validation: 1 ≤ x ≤ available).
  - حقل محسوب: إجمالي تكلفة المصدر.
- زر **"+ إضافة دفعة أخرى"**.
- إجمالي عدد النعام وإجمالي تكلفة المصادر معروضان في الأسفل.
- تعبئة `birds_slaughtered` و `total_live_weight_kg` تلقائيًا (وزن تقريبي بناءً على المتوسط من الدفعات المصدر) مع إمكانية التعديل.
- منع الحفظ لو:
  - لا يوجد مصدر واحد على الأقل.
  - أي صف عدده > المتاح.
  - تكرار نفس الدفعة.

## 3) `saveBatch` في `Slaughterhouse.tsx`
- بعد `INSERT` في `slaughter_batches` نأخذ `batch.id` ونعمل `INSERT` متعدد في `slaughter_batch_live_sources` مع `reference_id = slaughter_source_{batch.id}_{receipt.id}`.
- إذا فشل أي إدراج، نعمل rollback يدوي للدفعة (حذف `slaughter_batches`) لتجنّب البقايا.
- الخصم من `current_alive_count` يحدث تلقائيًا عبر الـ trigger في الـ DB.
- نحفظ `live_receipt_id` (القديم) = أول مصدر للحفاظ على التوافق مع الكود الحالي.

## 4) شاشة تفاصيل الدفعة
إضافة كرت "مصادر النعام" يعرض من `slaughter_batch_live_sources`:
رقم الدفعة، عدد المسحوب، تكلفة النعامة وقت الدبح، إجمالي التكلفة، العدد المتبقي حاليًا في الدفعة المصدر.

## 5) توزيع التكلفة على نواتج الذبح
- `إجمالي تكلفة النعام للدبح = SUM(total_birds_cost)`.
- يضاف لمصروفات الدبح المباشرة الموجودة حاليًا.
- منطق توزيع `cost_per_kg` الحالي يبقى كما هو، لكن المصدر الجديد للتكلفة هو الجدول الجديد.

## 6) منع التكرار + Audit
- `UNIQUE (slaughter_batch_id, live_receipt_id)` على مستوى DB.
- `UNIQUE reference_id` كحاجز ثاني.
- Trigger يسجّل في `slaughter_audit_log` كل سحب نعام مع snapshot.

## ملفات ستُعدّل
- migration جديد (جدول + trigger + RLS + GRANT).
- `src/components/slaughterhouse/SlaughterBatchDialog.tsx` (Step 1: استبدال الـ Select بجدول صفوف).
- `src/pages/modules/Slaughterhouse.tsx` (`saveBatch` + كرت تفاصيل المصادر).
- `BatchDraft` يضيف `sources: Array<{ live_receipt_id; birds_count }>`.

## ملاحظة
دفعات النعام الحالية المتاحة بعد التسوية: `OPENING-LIVE-OSTRICH-21` (13 حي، تكلفة 17,769.23). يمكن استخدامها لاختبار السيناريو، مع ملاحظة أنه لا توجد دفعة ثانية فعّالة الآن لاختبار المصدر المزدوج (LR-20260602-7312 حالتها rejected).

---
موافقتك تعني تنفيذ الـ migration أولًا، ثم تعديل الواجهة وحفظ الدفعة دفعة واحدة بعد قبول الـ migration.
