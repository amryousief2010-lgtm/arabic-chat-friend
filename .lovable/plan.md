## شاشة مصنع اللحوم — مرآة لمصنع الأعلاف

سأبني صفحة `/meat-factory/warehouses` بنفس بنية `FeedWarehouses` بالضبط، مع جداول و RPCs مستقلة لمصنع اللحوم حتى لا يختلط أي شيء مع مصنع الأعلاف.

---

### 1) قاعدة البيانات (Migration واحدة)

جداول جديدة (كلها بـ `GRANT` + `RLS` + Policies):

```text
meat_factory_raw_items          (اسم، وحدة، رصيد، متوسط تكلفة، حد تنبيه)
meat_factory_finished_items     (اسم، وحدة، رصيد، متوسط تكلفة، سعر بيع)
meat_factory_purchases          (تاريخ، مورد، إجمالي، طريقة دفع، الخزنة، حالة)
meat_factory_purchase_lines     (الفاتورة، الصنف، كمية، سعر)
meat_factory_manufacturing      (تاريخ، منتج نهائي، كمية، تكلفة، رقم فاتورة، حالة)
meat_factory_manufacturing_lines (الفاتورة، خامة، كمية، تكلفة)
meat_factory_sales              (تاريخ، عميل، إجمالي، دفع، الخزنة، حالة)
meat_factory_sales_lines        (الفاتورة، منتج، كمية، سعر)
meat_factory_sales_returns      (مرتجع، فاتورة أصلية، عميل، إجمالي، سبب، حالة، حركة مخزون id، حركة خزنة id)
meat_factory_sales_return_lines (المرتجع، منتج، كمية، سعر)
meat_factory_inventory_moves    (نوع الصنف raw/finished، IN/OUT، الكمية، السبب، المرجع)
meat_factory_treasury_txns      (تاريخ، IN/OUT، مبلغ، السبب، المرجع)
meat_factory_stocktaking        (تاريخ، نوع، حالة)
meat_factory_stocktaking_lines  (الصنف، رصيد سيستمي، فعلي، فرق، قيمة)
```

RPCs ذرّية (كل واحدة معاملة كاملة — إما تنجح بالكامل أو تُلغى):
- `approve_meat_purchase(id)` → IN للخامات + OUT للخزنة (نقدي) + تحديث متوسط التكلفة
- `approve_meat_manufacturing(id)` → فحص توفر الخامات → OUT للخامات + IN للمنتج النهائي + تحديث التكلفة. منع الاعتماد المزدوج.
- `approve_meat_sale(id)` → OUT للجاهز + IN للخزنة (نقدي)
- `approve_meat_sales_return(id)` → IN للجاهز + OUT للخزنة. منع التكرار.
- `cancel_meat_sales_return(id)` → عكس الحركتين (للمدير العام/التنفيذي فقط).
- `apply_meat_stocktake(id)` → حركات تسوية مخزون.

كل RPC تستخدم `SECURITY DEFINER` + فحص `has_role` للأدوار: `general_manager`, `executive_manager`, `meat_factory_manager`, `warehouse_supervisor` حسب العملية.

### 2) الواجهة

ملف واحد: `src/pages/meat/MeatWarehouses.tsx` — نسخة طبق الأصل من `FeedWarehouses.tsx` مع:

- العنوان: "مخازن مصنع اللحوم" والوصف "الخامات، التصنيع، المنتجات الجاهزة، المبيعات، الخزنة، والجرد"
- 5 كروت علوية: قيمة الخامات / قيمة الجاهز / رصيد الخزنة / مستحق لشركة نعام / عدد الأصناف
- 9 تبويبات بالترتيب المطلوب:
  1. الخامات
  2. المشتريات
  3. التصنيع
  4. الجاهز
  5. المبيعات
  6. الخزنة
  7. الجرد
  8. ↩️ مرتجع مبيعات (برتقالي)
  9. التقارير (تقارير حركة/مبيعات/مرتجعات/ربحية المنتجات)
- نفس تصميم RTL، نفس الأيقونات، نفس أزرار الطباعة/Excel، نفس الـ Dialogs.

### 3) الربط بالسيستم

- إضافة المسار `/meat-factory/warehouses` في `AnimatedRoutes.tsx`
- إضافة بند سايد بار "مخازن مصنع اللحوم — خامات/تصنيع/جاهز/بيع/خزنة/جرد" تحت قسم "مصنع اللحوم" (الصلاحيات: general_manager, executive_manager, meat_factory_manager, warehouse_supervisor, accountant, financial_manager)
- إضافة كارت سريع في `MeatFactoryDashboard` للوصول للصفحة
- توسيع صلاحيات قسم مصنع اللحوم في السايد بار لتشمل المحاسب/المالي/مسؤول المخزن

### 4) ضمانات

- لا أعدّل أي ملف من مصنع الأعلاف.
- كل العمليات Atomic عبر RPCs.
- منع الاعتماد المزدوج عبر check على `status` + أعمدة `*_movement_id` و`*_txn_id`.
- RLS صارم: قراءة للأدوار المصرحة، كتابة عبر RPC فقط.

---

### الحجم

- Migration واحدة كبيرة (~600 سطر SQL).
- ملف صفحة واحد كبير (~1300 سطر — نفس حجم FeedWarehouses).
- 3 ملفات تُعدّل (Routes, Sidebar, MeatDashboard).

سأنفذ على دفعتين: (أ) Migration للموافقة، ثم (ب) UI كاملة. هل أبدأ؟