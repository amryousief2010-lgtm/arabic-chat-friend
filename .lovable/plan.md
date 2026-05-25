# خطة استيراد بيانات Excel — Capital Ostrich

تنفيذ مرحلي عبر **staging tables + RPC** بدون كتابة مباشرة على الجداول الإنتاجية، مع تطبيق RLS وSecurity Definer.

---

## 1) الترتيب التنفيذي (8 مراحل)

| # | المصدر (Sheet) | الهدف | الوضع |
|---|---|---|---|
| 1 | Current_Products, Meat_Stock, Feed_Stock, Packaging_Materials | كتالوج موحد للأصناف | staging → approve → upsert |
| 2 | Warehouses | `warehouses` | upsert مباشر (idempotent by name) |
| 3 | Stock snapshots | `inventory_stock_snapshots` (staging) | لا يكتب على `inventory_items.stock` إلا بعد اعتماد |
| 4 | Meat_Costs (172/171/170/169), Feed_Costs (173/167/164) | `meat_factory_invoices`, `feed_invoice_batches` | تاريخي + إعادة حساب |
| 5 | Meat_BOM, Feed_BOM | `meat_factory_recipes`, `feed_recipes/items` | versioned + approval |
| 6 | Data_Quality | `data_quality_tasks` | auto-open tasks (negative_stock, missing_code, unit_mismatch) |
| 7 | Screens_Workflow | تفعيل routes/tabs موجودة | UI فقط |
| 8 | DB_Schema/Roles/Validation/Costing | triggers + RLS + helpers | migration واحدة |

---

## 2) جداول جديدة / تعديلات

### جديدة
- **`import_catalog_staging`** — للمرحلة (1)  
  `id, run_id, source_sheet, item_code, name_ar, category, unit, barcode, default_price, default_cost, module ('shared'|'meat'|'feed'|'packaging'), status ('pending'|'approved'|'rejected'|'posted'), error_reason, raw_row jsonb`
- **`inventory_stock_snapshots`** — للمرحلة (3)  
  `id, run_id, snapshot_date, warehouse_code, item_code, qty, unit, source_sheet, status, posted_movement_id, error_reason, raw_row jsonb`
- **`import_runs`** — meta للتشغيلات  
  `id, sheet, filename, uploaded_by, total_rows, valid_rows, error_rows, status ('uploaded'|'validated'|'approved'|'posted'|'failed'), created_at, posted_at, posted_by`

### تعديلات
- `meat_factory_invoices` + `feed_invoice_batches` → إضافة `import_run_id uuid` (FK اختياري) لتتبع المصدر.
- `meat_factory_recipes` + `feed_recipes` → إضافة `version int default 1`, `approved_by`, `approved_at`, `import_run_id`.
- `data_quality_tasks` (موجود) → إضافة index على `(module, status, severity)`.

### Helpers/Triggers
- `import_validate_catalog(run_id)` — يكشف التكرار، الوحدة الفارغة، الباركود المكرر.
- `import_post_catalog(run_id)` — upsert على `products` / `meat_factory_raw_materials` / `feed_raw_materials` / `inventory_items` حسب `module`.
- `import_post_stock_snapshot(run_id, warehouse_id)` — يدخل صفوف `inventory_movements` نوع `adjustment` بدلاً من الكتابة المباشرة.
- `import_open_quality_tasks(run_id)` — يفتح `data_quality_tasks` للصفوف المرفوضة + للأرصدة السالبة بعد الترحيل.

---

## 3) RLS Policies (موحدة)

كل الجداول الجديدة **RLS ENABLED**.

| الجدول | view | insert | update (status) | post (RPC) |
|---|---|---|---|---|
| `import_runs` | management + uploader | management + warehouse_supervisor + factory_managers | management | — |
| `import_catalog_staging` | management + uploader | management + warehouse_supervisor + factory_managers | management + accountant | RPC: `accountant` / `general_manager` / `executive_manager` |
| `inventory_stock_snapshots` | management + warehouse_supervisor | warehouse_supervisor + management | management | RPC: `warehouse_supervisor` / `general_manager` / `executive_manager` |

**لا يوجد** سياسة public select/insert. الكتابة الفعلية على المخزون تمر **حصراً** عبر `SECURITY DEFINER RPC` يتحقق من الدور داخلياً.

---

## 4) ملخص التحقق (Validation)

عند رفع كل sheet نشغّل قواعد:
- `item_code` مطلوب وفريد داخل الـ run.
- `unit` ضمن قائمة معتمدة (`كجم, جم, لتر, مل, قطعة, كيس, علبة, طبق`).
- `barcode` (إن وُجد) فريد عبر `products`.
- `qty >= 0` (السالب → quality task، لا يُرحَّل).
- `warehouse_code` يجب أن يطابق `warehouses.code`.
- صفوف Meat_Costs / Feed_Costs: `invoice_no` + `output_qty > 0` + كل سطر Input له `unit_cost`.
- صفوف BOM: لا بد من ربطها بـ invoice أو product موجود.

نخرج Preview JSON: `{ total, valid, errors_by_type, sample_errors[10] }` يظهر في الـ ImportWizard.

---

## 5) الشاشات / المسارات

موجودة بالفعل ونعيد استخدامها:
- `/modules/shared/import-wizard` (موجود) — ندعم اختيار sheet من القائمة الجديدة (8 خيارات).
- `/modules/shared/data-quality-tasks` (موجود).
- `/modules/shared/packaging-materials` (موجود).
- `/modules/meat-factory` — تبويب **اعتماد التكاليف** (موجود) + تبويب جديد **الوصفات (BOM)**.
- `/modules/feed-factory` — نفس الشيء (تبويب **الوصفات** + اعتماد التكاليف الموجود).

شاشة جديدة واحدة:
- `src/pages/modules/shared/StockSnapshotReview.tsx` — قائمة snapshots بانتظار الاعتماد، زر "ترحيل كتسوية مخزون".

---

## 6) خطوات التنفيذ

1. **Migration واحدة** بكل ما سبق (جداول + RLS + RPCs + indexes).
2. تحديث `ImportWizard` ليدعم 8 أوراق Excel ويوجّه كل ورقة لجدول staging المناسب.
3. صفحة `StockSnapshotReview` + ربطها في القائمة الجانبية للمدير العام/المخازن.
4. تسجيل تبويب **BOM** داخل `MeatFactory` و `FeedFactory` يعرض `meat_factory_recipes` / `feed_recipes` مع زر "اعتماد نسخة".
5. توثيق القواعد في `mem://features/import-pipeline`.

---

## 7) خارج النطاق

- لا تغييرات على auth أو الأدوار السبعة.
- لا حذف لأي بيانات قائمة.
- لا writes مباشرة على `products.stock` / `inventory_items.stock` / `*_raw_materials.stock` خارج RPC.
- لا تضمين بيانات الفواتير داخل migration (تُرفع عبر ImportWizard).

في انتظار الموافقة لبدء التنفيذ.