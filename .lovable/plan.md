# قسم مصنع الأعلاف – نعام العاصمة

اعتمادًا على ملف `Naam_Al_Asimah_Feed_Factory_Lovable_System.xlsx` (Dashboard / Production_Batches / Feed_Products / Manufacturing_BOM / Raw_Materials) سيتم بناء وحدة كاملة محمية بـ Auth + RLS، تكاملها مع وحدات المخازن، مزرعتي التسمين والأمهات، الحسابات، الإدارة والجودة.

---

## 1) قاعدة البيانات (Supabase + RLS)

ستُنشأ ضمن schema `public` بأسماء بادئة `feed_`:

- **feed_raw_materials** — كتالوج الخامات
  `item_code, name, category, unit, latest_unit_cost, cost_low, cost_high, criticality, is_packaging, warehouse_id, notes`
- **feed_products** — أنواع الأعلاف (الكتاكيت / تسمين / بياض + قابل للإضافة)
  `feed_code, name, stage, standard_batch_kg, default_bag_kg, latest_unit_cost, recipe_status, notes`
- **feed_recipes** + **feed_recipe_items** — وصفات بإصدارات
  `recipe_id, feed_product_id, version, is_active, status, created_by` / `item_id, qty, unit, unit_cost, is_packaging`
- **feed_production_orders** — أوامر الإنتاج
  `order_no, feed_product_id, recipe_id, target_output_kg, status (draft|issued|mixing|packed|qc_pending|approved|needs_review|rejected|posted), created_by, approved_by`
- **feed_material_issues** — صرف الخامات من مخزن أعلاف/أدوية للأمر
  `order_id, item_id, qty, unit_cost, warehouse_id, issued_by`
- **feed_production_batches** — الدفعة الفعلية (مطابقة لشيت Production_Batches)
  `batch_id, order_id, invoice_no, invoice_date, output_qty_kg, input_qty_invoice, input_qty_weight_kg, input_cost, operating_cost, invoice_output_total, unit_cost_invoice, unit_cost_calc, qty_variance_kg, qty_variance_pct, cost_diff, status, warehouse, source_file, notes`
- **feed_qc_checks** — اعتماد الجودة (بوابة قبل دخول المنتج التام)
  `batch_id, checked_by, result (pass|fail|needs_review), variance_reason, attachments, decided_at`
- **feed_finished_goods_moves** — حركات المنتج التام (تدخل المخزون فقط بعد QC pass)
- **feed_cost_reviews** — مراجعات تكلفة الكيلو
- **feed_audit_log** — سجل تدقيق لكل تغيير حالة/اعتماد

### الصلاحيات (role_name → القدرة)
| الدور | عرض | إنشاء وصفة | إصدار أمر إنتاج | صرف خامات | اعتماد جودة | اعتماد تكلفة |
|---|---|---|---|---|---|---|
| general_manager / executive_manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| feed_factory_manager (جديد) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ |
| warehouse_supervisor | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| quality_officer (جديد) | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ |
| accountant | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |

RLS: قراءة لكل أصحاب الأدوار أعلاه فقط؛ كتابة محددة عبر `has_role()` لكل عملية. لا حذف فيزيائي — فقط `archived_at`.

### قواعد التحقق (Validation_Rules)
- لا يمكن `issue_material` إذا مخزون الخامة < الكمية المطلوبة.
- لا يمكن `qc.approve` إلا لدور `quality_officer` فأعلى.
- إذا `qty_variance_pct > +1%` ⇒ الحالة تلقائيًا `needs_review` وتنتقل لاعتماد المدير.
- المنتج التام لا يدخل `feed_finished_goods_moves` إلا عند `qc.result = pass`.
- كل تغيير حالة يُسجَّل في `feed_audit_log` (user, old, new, diff, timestamp) عبر trigger.

---

## 2) الشاشات داخل التطبيق (مسار `/modules/feed/*`)

```text
/modules/feed                  → Dashboard (KPIs: عدد الأعلاف، عدد الدفعات، إجمالي الناتج، متوسط تكلفة/كجم، دفعات تحتاج مراجعة)
/modules/feed/recipes          → إدارة الوصفات (إصدارات، تفعيل، نسبة كل خامة، مستلزمات التعبئة منفصلة)
/modules/feed/recipes/:id      → تفصيل وصفة + Inclusion_Rate_% + Cost_Share_%
/modules/feed/orders           → أوامر الإنتاج (قائمة + فلاتر)
/modules/feed/orders/new       → إنشاء أمر إنتاج (نوع علف + كمية مستهدفة → يحسب صرف الخامات تلقائيًا)
/modules/feed/orders/:id       → خط سير: صرف ← خلط ← تعبئة ← جودة ← اعتماد
/modules/feed/issues           → صرف الخامات (يحدّث رصيد المخزن مباشرة)
/modules/feed/qc               → طابور الجودة (Pass / Fail / Needs Review مع سبب)
/modules/feed/inventory        → مخزون خامات + منتج تام
/modules/feed/costs            → تحليل تكلفة/كجم لكل دفعة + ألوان للتنبيهات
/modules/feed/reports          → تقارير + تصدير Excel/PDF
/modules/feed/audit            → سجل تدقيق كامل
```

تنبيه فرق الكمية: شارة حمراء على أي دفعة `qty_variance_pct > +1%` (مثل دفعة علف بياض 164 في البيانات الأولية).

---

## 3) استيراد البيانات الأولية (Lovable_Import)

عبر Edge Function `import-feed-data` يقرأ الملف الذي رفعته ويُدرج:
- 3 منتجات أعلاف (16003 / 16001 / 16007)
- 3 وصفات نشطة + بنودها (Manufacturing_BOM)
- 3 دفعات إنتاج (Production_Batches) مع حالاتها الصحيحة (دفعة 164 = needs_review)
- كتالوج الخامات (Raw_Materials)

---

## التفاصيل التقنية

- **Schema**: 9 جداول جديدة + ENUM لحالات الأمر والجودة + 3 triggers (variance auto-flag, audit_log, stock guard).
- **RLS**: سياسات `SELECT` و`INSERT`/`UPDATE` لكل جدول مرتبطة بـ `has_role()` ودالة `is_feed_team()` جديدة.
- **Frontend**: React + Tailwind + shadcn، Recharts للرسوم، framer-motion، RTL/Arabic. كل شاشة محمية بـ `ProtectedRoute` بقائمة أدوار محددة.
- **Sidebar**: إضافة بند رئيسي "مصنع الأعلاف" مع 9 روابط فرعية (Dashboard, Recipes, Orders, Issues, QC, Inventory, Costs, Reports, Audit).
- **التكامل**: حركات الخامات تخصم من جدول `inventory` العام للمخزن "مخزن أعلاف وأدوية"؛ المنتج التام يضاف بعد اعتماد الجودة فقط.
- **الاستيراد الأولي**: Edge Function `import-feed-data` مع service role لتخطي RLS أثناء الإدخال الأول، وزر تشغيله يظهر فقط لـ `general_manager`.
- **التدقيق**: trigger موحّد `feed_log_changes()` يكتب JSONB diff في `feed_audit_log`.
- **التصدير**: يعيد استخدام `src/utils/exportReports.ts` + `safeParseExcel` الموجودين.

---

## التنفيذ على مراحل

نظرًا لحجم العمل، سأنفّذ على 3 موجات متتابعة:

1. **الموجة 1** — Migration كامل (جداول + ENUMs + RLS + triggers + دور `feed_factory_manager` و`quality_officer`) + Edge Function للاستيراد.
2. **الموجة 2** — الواجهة الأساسية: Sidebar + Dashboard + Recipes + Orders + Issues.
3. **الموجة 3** — QC + Costs + Reports + Audit + ربط زر "استيراد البيانات الأولية" وتشغيله.

هل أبدأ بالموجة 1 (Migration + Edge Function للاستيراد)؟
