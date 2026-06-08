
# ربط مصنع العلف بمخازن الحضانات والمجزر

## نظرة عامة
تعديل فاتورة بيع/توريد مصنع العلف لتدعم ٣ أنواع عمليات (بيع خارجي / توريد لحضانات التسمين / توريد لمخزن علف المجزر الجديد)، مع تنفيذ الحركات تلقائيًا عند الاعتماد، ومنع تكرار نفس الفاتورة، وتقارير شهرية لكل جهة.

---

## ١. قاعدة البيانات (Migration)

### أ. مخزن علف المجزر الجديد
جدول `slaughterhouse_feed_inventory`:
- `feed_product_id` (FK إلى feed_products)
- `qty_in_total`, `qty_out_total`, `balance` (محسوبة من الحركات)
- صف واحد لكل صنف علف

جدول `slaughterhouse_feed_movements`:
- `feed_product_id`, `movement_type` (in/out/correction)
- `quantity`, `unit_cost`, `total_cost`
- `source_type` (`feed_factory_invoice` | `manual_issue` | `correction`)
- `source_id` (UUID فاتورة المصنع أو غيره)
- `invoice_no` (نص للعرض)
- `reference_no`, `notes`, `performed_by`, `performed_at`

**قيد منع التكرار (الأهم):**
```sql
CREATE UNIQUE INDEX uniq_sl_feed_invoice_in
ON slaughterhouse_feed_movements(source_type, source_id)
WHERE source_type = 'feed_factory_invoice' AND movement_type = 'in';
```

### ب. تعديل جدول حركات علف الحضانات `brooding_feed_stock_movements`
إضافة الأعمدة (إن لم توجد):
- `source_type TEXT` (`feed_factory_invoice` | `manual` | `correction`)
- `source_id UUID`
- `invoice_no TEXT`

**قيد منع التكرار:**
```sql
CREATE UNIQUE INDEX uniq_br_feed_invoice_in
ON brooding_feed_stock_movements(source_type, source_id)
WHERE source_type = 'feed_factory_invoice' AND movement_type = 'in';
```

### ج. تعديل فاتورة المصنع `feed_sales`
إضافة:
- `destination_type TEXT NOT NULL DEFAULT 'external_customer'`
  القيم: `external_customer` | `brooding_feed_store` | `slaughterhouse_feed_store`
- `destination_ref_id UUID NULL` (اختياري — حضانة محددة لو احتجناه لاحقًا)
- `internal_transfer BOOLEAN GENERATED ALWAYS AS (destination_type <> 'external_customer') STORED`

### د. Trigger الاعتماد
دالة `apply_feed_sale_on_approval()` تعمل بعد UPDATE على `feed_sales` عند انتقال `status` إلى `approved/closed`:
1. خصم الكمية من مخزون مصنع العلف (موجود حاليًا — نتركه).
2. لو `destination_type = 'brooding_feed_store'`: إدراج صف `in` في `brooding_feed_stock_movements` لكل بند بـ `source_type='feed_factory_invoice'`, `source_id=invoice.id`.
3. لو `destination_type = 'slaughterhouse_feed_store'`: نفس الشيء في `slaughterhouse_feed_movements`.
4. الـ UNIQUE INDEX يمنع التكرار لو الفاتورة اعتُمدت مرتين.
5. لو `external_customer`: لا حركة مخزن داخلي.

### هـ. Audit
تسجيل العمليات في `feed_audit_log` الموجود + لوج جديد `slaughterhouse_feed_audit_log` لحركات المجزر.

### و. RLS & GRANTS
- مدير المصنع / المدير العام: full
- مسؤول الحضانات: SELECT على movements حضانات + INSERT للصرف فقط
- مسؤول المجزر: SELECT/INSERT صرف على مخزن المجزر
- GRANT للأدوار حسب القواعد

---

## ٢. الواجهة (Frontend)

### أ. صفحة فاتورة بيع/توريد مصنع العلف
`src/pages/feed/FeedWarehouses.tsx` + نموذج إنشاء الفاتورة:
- Radio/Select لـ "نوع العملية":
  - بيع خارجي لعميل
  - توريد داخلي → حضانات التسمين
  - توريد داخلي → مخزن علف المجزر
- حقل "الجهة المستلمة" يظهر شرطيًا.
- Badge على الفاتورة بعد الحفظ يوضح نوع التوريد.

### ب. مخزن علف المجزر (صفحة جديدة)
`src/pages/slaughterhouse/SlaughterhouseFeedStore.tsx`:
- تبويبات: الأرصدة الحالية / حركات وارد / حركات صرف / تقرير شهري.
- جدول الأرصدة (صنف، وارد، مصروف، الرصيد).
- زر "صرف علف للنعام التسمين" → modal بسيط.
- مصدر كل حركة وارد يظهر "فاتورة مصنع العلف #..." بـ link.

أضف الراوت في `src/App.tsx` تحت `/modules/slaughterhouse/feed-store`.

### ج. مخزن علف الحضانات (موجود)
ملف `src/components/farm/MotherFarmFeedInventory.tsx` أو ما يقابله في الحضانات: إضافة عمود "مصدر" + "فاتورة المصنع" + فلتر "وارد من مصنع العلف".

### د. التقارير
صفحة `src/pages/feed/FeedDistributionReports.tsx`:
- تقرير توريدات مصنع العلف (بيع خارجي / حضانات / مجزر).
- تقرير وارد علف الحضانات.
- تقرير وارد علف المجزر.
- تقرير شهري مجمع (إنتاج / خارجي / حضانات / مجزر / أرصدة).
- فلاتر: من/إلى، نوع علف، الجهة، رقم فاتورة، نوع العملية.
- تصدير Excel/PDF.

### هـ. سايدبار
إضافة بند "مخزن علف المجزر" تحت مجموعة المجزر، وبند "تقارير توزيع الأعلاف" تحت مصنع الأعلاف، في `src/components/layout/SidebarMenuSections.tsx`.

---

## ٣. منع التكرار + Audit
- UNIQUE INDEX على (source_type, source_id, movement_type='in') لكل من المخزنين.
- لو حصل تكرار: Trigger يرفع exception برسالة عربية واضحة.
- إلغاء أثر حركة = إدراج حركة عكسية فقط (لا حذف). زر للمدير العام فقط في صفحات المخازن.

---

## ٤. الصلاحيات (RBAC)
استخدام `has_role` الحالي:
- `feed_factory_manager` / `general_manager`: إنشاء + اعتماد فواتير مصنع العلف.
- `brooding_supervisor`: قراءة وارد + تسجيل صرف علف حضانات.
- `slaughterhouse_supervisor`: قراءة وارد + تسجيل صرف علف المجزر.
- `general_manager` / `executive_manager`: كل التقارير + إلغاء أثر حركة بعكسية.

---

## ملاحظات تقنية
- الاعتماد على Trigger يضمن أن أي اعتماد للفاتورة (من UI أو SQL) ينفذ الحركات.
- مخزون مصنع العلف: لا نغيّر منطق الخصم الحالي (`feed_sale_items` → خصم من `feed_products.stock`)، فقط نضيف حركة استلام للمخزن الداخلي.
- التحويل الداخلي يُسجَّل بتكلفة الفاتورة (cost transfer) — لا يُسجَّل كإيراد خارجي.
- الـ UNIQUE INDEX يحمي حتى لو تم استدعاء Trigger مرتين بسبب race condition.

---

## ترتيب التنفيذ
1. Migration واحدة (مخزن مجزر + أعمدة destination + triggers + indexes + grants).
2. تعديل نموذج فاتورة مصنع العلف لإضافة `destination_type`.
3. صفحة مخزن علف المجزر + الراوت + السايدبار.
4. تحديث صفحة مخزن علف الحضانات لعرض المصدر.
5. صفحة التقارير المجمعة.
6. اختبار: إنشاء فاتورة لكل نوع + محاولة اعتماد مكرر للتأكد من رفض التكرار.
