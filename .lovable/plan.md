# خطة تطوير مصنع اللحوم (Meat Factory)

النواة موجودة بالفعل (8 جداول + شاشة 1090 سطر تغطي المنتجات/الخامات/الفواتير/الوصفات/الدفعات/QC/الاستهلاك/سجل الاعتمادات). الخطة تركز على **سد الفجوات** المطلوبة في الـ Prompt دون إعادة بناء.

## الفجوات الحالية مقابل المطلوب
| المطلوب | الحالي | الإجراء |
|---|---|---|
| باركود لجميع المنتجات | 29/30 لديهم باركود | مراجعة Burger Cheese / Mombar في شاشة المنتجات |
| فواتير 169/170/171/172 | غير موجودة في DB | استيراد عبر Import Wizard الموجود |
| محرك تكلفة كامل: (مدخلات + أجور + مصاريف − ناتج ثانوي) / كمية معتمدة | لدينا labor + materials فقط | إضافة أعمدة + احتساب |
| التغليف كتكلفة منفصلة | غير مرتبط بالدفعة | جدول `meat_factory_batch_packaging` |
| اعتماد محاسبي للتكلفة | غير موجود | حقول + RPC `approve_meat_batch_cost` |
| تنبيهات أرصدة سالبة + تسوية | `data_quality_tasks` موجود | تريغر على inventory + ربط واجهة |
| لوحات (تكلفة/كجم، أعلى تكلفة، نواقص، حالة) | محدودة | تبويب Dashboard متكامل |
| تطبيق الأدوار السبعة | RLS أساسي | تحديث policies للأدوار الجديدة |

## المرحلة 1 — Migration

### تعديلات على `meat_factory_batches`
- `other_expenses numeric DEFAULT 0`
- `byproduct_value numeric DEFAULT 0`
- `packaging_cost numeric DEFAULT 0`
- `approved_output_qty numeric` (يُعتمد بعد QC ليكون مقام التكلفة)
- `cost_approved_by uuid`, `cost_approved_at timestamptz`, `cost_approval_notes text`
- `posted_to_inventory boolean DEFAULT false`, `posted_at timestamptz`

### جدول جديد `meat_factory_batch_packaging`
`id, batch_id, packaging_material_id (→ packaging_materials), quantity, unit_cost, line_total`

### دوال
- `recompute_meat_batch_cost(p_batch_id)` — يُحدّث `total_cost = materials + labor + other_expenses + packaging − byproduct_value` و `unit_cost = total_cost / approved_output_qty`.
- `approve_meat_batch_cost(p_batch_id, p_notes)` — يتحقق من الدور (`accountant`/`financial_manager`/`general_manager`/`executive_manager`)، يستدعي الاحتساب، يسجل المعتمد، يُرحّل المخزون (يستلم المنتج التام في warehouse الرئيسي عبر `inventory_movements`).
- `meat_batch_negative_stock_check()` — تريغر بعد صرف الخامات، يُنشئ مهمة في `data_quality_tasks` لو رصيد < 0.

### RLS / Roles
أدوار جديدة في enum `app_role` لو ناقصة: `meat_factory_manager`, `meat_factory_supervisor`, `meat_factory_warehouse`, `cost_accountant`, `quality_manager` (موجود).
Policies:
- READ: كل الأدوار أعلاه + management + admin.
- INSERT/UPDATE دفعة: meat_manager/supervisor/warehouse + management.
- اعتماد QC: quality_manager فقط.
- اعتماد التكلفة: cost_accountant/financial_manager/management.

## المرحلة 2 — تحديثات الواجهة

### `src/pages/modules/MeatFactory.tsx`
- نموذج إنشاء الدفعة: إضافة حقول `other_expenses`, `byproduct_value`, `packaging` (selector + qty).
- تبويب الدفعة (BatchDetail dialog) يعرض:
  - استهلاك الخامات (موجود)
  - **التغليف** (جدول جديد)
  - **ملخص التكلفة** (مدخلات + أجور + مصاريف + تغليف − ناتج ثانوي)
  - زر "اعتماد التكلفة" (للمحاسبة فقط) → يستدعي RPC
  - زر "ترحيل للمخزون" يظهر بعد الاعتماد
- تبويب جديد **Dashboard**:
  - KPIs: عدد الدفعات الشهر، إجمالي الإنتاج كجم، متوسط تكلفة/كجم، عدد بانتظار اعتماد.
  - Recharts: أعلى 5 منتجات تكلفة، تطور تكلفة/كجم شهريًا، توزيع حالة الدفعات.
  - جدول النواقص (من `data_quality_tasks` type=negative_stock).
- تبويب **Packaging** يستهلك `PackagingMaterials.tsx` الموجود لكن مفلتر `module='meat'`.

### مكوّن جديد `BatchCostApprovalDialog.tsx`
ملخص التكلفة + ملاحظات + زر اعتماد.

### مكوّن جديد `NegativeStockReconcileDialog.tsx`
يفتح من Dashboard، يسمح بتسوية يدوية (adjustment) مع سبب.

## المرحلة 3 — استيراد الفواتير 169-172
- لن أكتبها يدويًا في migration. تستخدم `ImportWizard` الموجود مع ورقة `Invoice_172/171/170/169` من نفس الـ workbook.
- بعد الاستيراد، `meat_factory_recipes` تمتلئ تلقائيًا (سكربت موجود) ويظهر الزر "إنشاء دفعة من فاتورة" لكل من 172/171/170/169.

## ملفات ستُعدَّل أو تُنشَأ
**تُنشَأ:**
- `supabase/migrations/<ts>_meat_factory_costing_v2.sql`
- `src/components/meat/BatchCostApprovalDialog.tsx`
- `src/components/meat/NegativeStockReconcileDialog.tsx`
- `src/components/meat/MeatDashboard.tsx`

**تُعدَّل:**
- `src/pages/modules/MeatFactory.tsx` (حقول جديدة + تبويبات + ربط RPCs)
- `src/integrations/supabase/types.ts` (تلقائي بعد migration)

## ما لن أفعله
- لن أنشئ صفحات عامة أو endpoints بدون JWT.
- لن أكتب أرصدة مخزون بدون اعتماد محاسبي.
- لن أُدخل بيانات فواتير 169-172 يدويًا في migration — تُرفع عبر Import Wizard لتسجَّل في staging أولًا.
- لن أُغيّر إعدادات SEO/robots/أمان.

## للموافقة
1. هل أبدأ بالـ migration (المرحلة 1) الآن؟
2. هل توافق أن "اعتماد التكلفة" هو الذي يُرحِّل المنتج التام للمخزون (وليس QC)؟
3. هل أعتمد warehouse المخزن الرئيسي تلقائيًا كوجهة المنتج التام، أم تريد اختياره يدويًا في كل دفعة؟
