
## نظرة عامة

ملف Excel يحتوي على 19 ورقة (كتالوج، مخزون، باركود، تغليف، فواتير تصنيع، وصفات BOM، قواعد تكلفة، صلاحيات، مخطط جداول، شاشات). النظام داخلي بالكامل خلف Auth + RLS. لن تُنشأ صفحات عامة ولن تُغيَّر إعدادات الأمان أو SEO.

النظام الحالي يحتوي بالفعل على طبقة جيدة من الجداول لمصنعَي اللحوم والأعلاف (`meat_factory_*`, `feed_*`, `inventory_movements`, `warehouses`)، لذا الخطة هي **توسعة وتوحيد** وليس إعادة بناء.

## مراحل التنفيذ (مقترحة بالترتيب)

### المرحلة 1 — الأساس المشترك (Shared)
- توحيد `items` كدليل أصناف موحد (خامات/تغليف/منتج تام/خدمة) مع `item_type`، `category`، `unit`، `barcode`.
- إضافة جدول `packaging_materials` (10 أصناف من الورقة).
- مزامنة `warehouses` مع: المخزن الرئيسي (المحتسب 3 - لحوم 101 صنف)، مخزن الأعلاف (المحتسب 10 - 20 صنف)، مخزن تغليف.
- جدول `stock_balances` (تجميع لحظي من `inventory_movements`).
- جدول `audit_log` موحّد + جدول `import_staging` للاستيراد المرحلي.

### المرحلة 2 — استيراد البيانات على مراحل (Staging)
المسار الإلزامي: **رفع → معاينة → تحقق → حل أخطاء → اعتماد → ترحيل**.
الترتيب:
1. كتالوج الأصناف (`Current_Products`, `Packaging_Materials`).
2. لقطات المخزون (`Meat_Stock` 101 صنف، `Feed_Stock` 20 صنف) إلى staging.
3. فواتير الإنتاج التاريخية (13 فاتورة لحوم + 3 أعلاف) كـ batches.
4. وصفات BOM مرتبطة بالـ batches.
5. مهام مراجعة من `Data_Quality` (19 رصيد سالب).

لا تُكتب أرصدة الإنتاج مباشرة بدون معاملة استيراد معتمدة.

### المرحلة 3 — مصنع اللحوم (Meat)
- شاشة كتالوج المنتجات + ربط الباركود (مع تنبيه على Burger Cheese و Mombar للمراجعة).
- شاشة الوصفات `meat_recipes` + `meat_recipe_items` مع نسخ واعتماد.
- شاشة دفعة الإنتاج من الفواتير (172 مفروم، 171 حواوشي، 170 برجر، 169 كفتة أرز).
- محرك التكلفة الفعلية: `unit_cost = (مدخلات + أجور + مصاريف − ناتج ثانوي) / كمية ناتجة معتمدة`.
- ترحيل تلقائي: صرف الخامات، استلام المنتج التام، خصم التغليف كتكلفة.
- فحص جودة قبل الترحيل النهائي + اعتماد محاسبي.
- لوحة تنبيهات الأرصدة السالبة وسير عمل التسوية.
- لوحات: تكلفة/كجم، أعلى المنتجات تكلفة (كباب 341، شيش 277، طرب نعام 234)، حالات الدفعات.

### المرحلة 4 — مصنع الأعلاف (Feed)
- منتجات: علف بياض، علف تسمين، علف كتاكيت.
- خامات: ذرة، صويا، ردة، بريمكس، حجر جيري، ملح، دريس، شكاير.
- تركيبات `feed_formulas` بنسب `inclusion_rate` مع **فصل التغليف** (`is_packaging=true` يدخل التكلفة لا النسبة الغذائية).
- دفعات إنتاج بناءً على الفواتير (173 تسمين، 167 كتاكيت، 164 بياض مع `variance_review_flag`).
- تحقق فروقات الكمية (Output > Input يحتاج اعتمادًا).
- لوحات: تكلفة كجم/طن، تغطية الخامات، آخر أسعار شراء، أرصدة سالبة.

### المرحلة 5 — الأمان والصلاحيات
- 7 أدوار مطبَّقة في UI و RLS: Admin، Management، Cost_Accounting، Meat_Manager/Supervisor/Warehouse، Feed_Manager/Supervisor/Warehouse، Quality.
- الاعتماد والترحيل عبر Edge Functions (server-side) فقط.
- Audit log لكل: تعديل وصفة، تغيير دفعة، اعتماد تكلفة، ترحيل مخزون، استيراد Excel، تسوية يدوية.

### المرحلة 6 — لوحات القيادة والتقارير
شاشات تنفيذية لكل مصنع + تقارير قابلة للتصدير (Excel/PDF) مع فلاتر شهرية UTC.

## الجداول التي ستُعدَّل أو تُنشأ

**موجودة وستُحدَّث (لن تُحذف):**
- `meat_factory_products`, `meat_factory_recipes`, `meat_factory_batches`, `meat_factory_raw_materials`, `meat_factory_invoices`, `meat_factory_batch_consumption`, `meat_factory_quality_log`, `meat_factory_approval_audit`
- `feed_products`, `feed_recipes`, `feed_recipe_items`, `feed_production_batches`, `feed_raw_materials`, `feed_invoice_batches`, `feed_batch_consumption`, `feed_qc_checks`, `feed_cost_reviews`, `feed_audit_log`, `feed_finished_goods_moves`, `feed_material_issues`
- `inventory_movements`, `warehouses`

**ستُنشأ:**
- `items` (دليل موحّد) + `packaging_materials`
- `stock_balances`
- `import_staging_meat_stock`, `import_staging_feed_stock`, `import_staging_products`
- `meat_recipe_items` (بنود مفصّلة)
- `feed_formulas` view/alias فوق `feed_recipes` بحقل `inclusion_rate` و `is_packaging`
- `data_quality_tasks` (لمتابعة الأرصدة السالبة)

**سياسات RLS:** ستُحدَّث لتطابق مصفوفة الأدوار السبعة في `Roles_Permissions`.

## الملفات/المسارات في الواجهة

- `src/pages/modules/MeatFactory.tsx` (إعادة هيكلة)
- `src/pages/modules/meat/` جديد: `Products.tsx`, `Recipes.tsx`, `Batches.tsx`, `BatchDetail.tsx`, `Costing.tsx`, `Dashboard.tsx`
- `src/pages/modules/FeedFactory.tsx` (إعادة هيكلة)
- `src/pages/modules/feed/Formulas.tsx`, `Batches.tsx`, `Dashboard.tsx` (توسعة الموجود)
- `src/pages/modules/shared/ImportWizard.tsx` (رفع → معاينة → اعتماد)
- `src/pages/modules/shared/NegativeStockTasks.tsx`
- Edge functions: `post-meat-batch`, `post-feed-batch`, `import-stock-snapshot`, `approve-batch-cost`
- تحديث `src/components/AnimatedRoutes.tsx` بالمسارات الجديدة + ProtectedRoute بالأدوار.

## ما لن أفعله
- لن أُنشئ أي صفحة عامة أو endpoint بدون JWT.
- لن أعدّل إعدادات SEO أو `robots.txt`.
- لن أكشف `service_role` في الواجهة.
- لن أكتب أرصدة مخزون مباشرة دون معاملة استيراد معتمدة.

## للموافقة
أكّد لي:
1. هل أبدأ بالمرحلة 1 (الأساس + جداول staging) في migration واحدة، أم تفضّل تقسيمها؟
2. هل أبني محرك التكلفة بنفس الصيغة في الورقة (مدخلات + أجور + مصاريف − ناتج ثانوي) لكل من اللحوم والأعلاف؟
3. هل تريد استيراد بيانات الفواتير الـ13 + الـ3 تلقائيًا كـ batches تاريخية بعد إنشاء الجداول، أم لاحقًا يدويًا عبر شاشة الاستيراد؟
