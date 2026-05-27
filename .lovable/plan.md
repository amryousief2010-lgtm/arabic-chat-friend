## الهدف
1. حساب جديد لأحمد خاطر: مسؤول مخزن العجوزة + صلاحية المجزر (تقسيمة دبح النعام).
2. تدفق طلب تحويل من الرئيسي للعجوزة بموافقة هادي.
3. شاشة لهادي يحصّل بيها فلوس أوردرات المندوب الخاص (تجميعة دفعة واحدة + إيصال مطبوع).

---

## 1) حساب أحمد خاطر
- إيميل: `ahmed.khater@coceg.net`
- باسورد: `Khater@2026`
- اسم: `أحمد خاطر`
- يتعمل عبر edge function `create-employee` الحالي.
- دور جديد في الـ enum: `agouza_warehouse_keeper`.

**صلاحياته:**
- مخزن العجوزة: تعديل الاستوك + رؤية أوردرات العجوزة + طلب تحويل من الرئيسي.
- المخزن الرئيسي: قراءة فقط.
- المجزر: إنشاء/إدارة Slaughter Batch (نفس صلاحيات `slaughterhouse_manager` في هذا الجزء).
- ممنوع يوافق على طلبات تحويله.

---

## 2) تدفق التحويل
- زرار في مخزن العجوزة: "طلب تحويل من الرئيسي" يفتح Dialog فيه قائمة منتجات وكميات مطلوبة.
- هادي يشوف الطلب في tab الموافقات (موجود في `WarehouseDetail`) ويقدر يعدل كل كمية ويوافق أو يرفض.
- `can_approve_warehouse_transfer` تتأكد إن المُوافِق ≠ مُقدم الطلب.
- الموافقون: `warehouse_supervisor` + `general_manager` + `executive_manager`.

---

## 3) شاشة تحصيل المندوب الخاص (هادي)
صفحة جديدة: `/warehouse/main/private-delivery-collection`

**العرض:**
- جدول بأوردرات شرطها: `shipping_method = private_delivery` + `source_warehouse_id = الرئيسي` + `status = delivered` + `payment_status != paid`.
- مجمّعة حسب المندوب (تاب لكل مندوب أو فلتر).
- كل سطر: رقم الأوردر، العميل، الإجمالي، التاريخ، checkbox للاختيار.

**التحصيل (تجميعة):**
- هادي يحدد مجموعة أوردرات.
- يظهر مودال "تحصيل دفعة":
  - الإجمالي المطلوب (محسوب تلقائي)
  - حقل: المبلغ الفعلي المحصّل
  - لو الفعلي ≠ المطلوب → يظهر حقل إجباري "سبب الفرق" (مرتجع/خصم/نقص/…)
  - زرار "حفظ + طباعة الإيصال" + زرار "حفظ بدون طباعة"
- عند الحفظ:
  - الأوردرات المختارة: `payment_status = paid`، `collected_by = هادي`، `collected_at = now()`، `collection_batch_id = …`.
  - يتسجل صف في جدول جديد `delivery_collection_batches` (id, rep_id, collector_id, expected_total, actual_total, variance_amount, variance_reason, collected_at).
  - يتسجل ربط في `delivery_collection_batch_orders` (batch_id, order_id, order_total).
- الإيصال PDF فيه: تاريخ، اسم هادي، اسم المندوب، جدول الأوردرات وإجمالي كل واحد، المطلوب، المحصّل، الفرق وسببه، توقيع.

**الوصول:** `warehouse_supervisor` + GM/Exec.

---

## 4) تعديلات إضافية
- زرار في المخزن الرئيسي/الـ sidebar لهادي: "تحصيل المندوب الخاص" + Badge بعدد الأوردرات الجاهزة للتحصيل.
- صفحة "سجل التحصيلات السابقة" (read-only) عشان مرجع وإعادة طباعة الإيصال.
- Landing page لأحمد = `/warehouse-stock/agouza`.

---

## التفاصيل التقنية

### Migration
1. إضافة `'agouza_warehouse_keeper'` لـ `app_role` enum.
2. تحديث `can_approve_warehouse_transfer(uid)` ليرجع false لو `uid = requested_by`.
3. إضافة أعمدة على `orders`: `collected_by uuid`, `collected_at timestamptz`, `collection_batch_id uuid`.
4. جدول `delivery_collection_batches` + جدول `delivery_collection_batch_orders` (مع GRANTs + RLS).
5. RLS:
   - `inventory_items` UPDATE لـ `agouza_warehouse_keeper` على warehouse العجوزة فقط.
   - `slaughter_batches` (+ الجداول المرتبطة) INSERT/UPDATE للدور الجديد.
   - `warehouse_transfers` INSERT للدور الجديد.
   - `delivery_collection_batches` INSERT/SELECT لـ `warehouse_supervisor` + GM/Exec.

### Frontend
- `useAuth`: إضافة `isAgouzaWarehouseKeeper`, `canManageAgouzaStock`, وتوسيع `canManageSlaughterhouse`.
- `roleLandings.ts`: `agouza_warehouse_keeper → /warehouse-stock/agouza`.
- Dialog: `AgouzaTransferRequestDialog.tsx`.
- صفحة: `PrivateDeliveryCollection.tsx` + Dialog `CollectBatchDialog.tsx`.
- صفحة: `CollectionHistory.tsx`.
- PDF: `printCollectionReceipt.ts` (يستخدم نفس نمط `printUtils`).
- Sidebar links + ProtectedRoute للروابط الجديدة.

### Edge function
- استدعاء `create-employee` الحالي لإنشاء حساب أحمد + profile + user_role.

---

## خطوات التنفيذ
1. Migration للـ enum + الجداول + RLS + الأعمدة الجديدة.
2. إنشاء حساب أحمد خاطر.
3. Frontend (useAuth + roleLandings + Dialog طلب التحويل).
4. شاشة التحصيل + Dialog التجميعة + PDF الإيصال + سجل التحصيلات.
5. اختبار end-to-end: تسجيل دخول بأحمد، طلب تحويل، موافقة هادي، تحصيل تجميعة بفرق + طباعة إيصال.

بعد ما توافق، هبدأ بالـ migration.