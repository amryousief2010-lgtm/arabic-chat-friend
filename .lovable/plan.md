# خطة وحدة "المندوب الخاص وخطوط السير"

## مبدأ صارم
- لا يتم تعديل أي ملف من ملفات الطلبات الحالية: `NewOrder.tsx`, `Orders.tsx`, `OrderDetails.tsx`, RLS الخاصة بـ `orders`/`order_items`/`customers`, التريجرز، خصم المخزون، التحصيل، الأسعار، العروض.
- لا تُضاف أي أعمدة جديدة على `orders` ولا على `customers`.
- الوحدة الجديدة **تقرأ** الطلبات المؤهلة فقط (`shipping_company='مندوب خاص' AND fulfillment_type='delivery' AND source_warehouse_id=<المخزن الرئيسي>`) وتربطها بجداولها الخاصة عبر `order_id` فقط.
- `route_id` الموجود حاليًا على `orders` **يبقى كما هو** ولن يُعدل من الوحدة الجديدة (لتفادي أي أثر على Orders). الربط الجديد يتم في جدول وسيط جديد.

---

## 1) الجداول الجديدة (كلها داخل schema جديد منفصل لعزل تام)

سيتم إنشاء **schema منفصل** اسمه `private_courier` لضمان عدم التداخل مع الجداول الحالية ولا مع RLS الحالية.

```text
private_courier.routes                  -- خطوط السير (منفصلة عن delivery_routes القديم)
private_courier.route_orders            -- ربط M:1 بين الطلب والخط + بيانات التخطيط
private_courier.order_tracking          -- حالة المندوب الخاص للطلب (assigned → delivered)
private_courier.handovers               -- تتبع تسليم المخزن للمندوب
private_courier.collections             -- تتبع التحصيل المنفصل
private_courier.failed_attempts         -- محاولات التوصيل الفاشلة + السبب
```

### الأعمدة الأساسية

**`routes`**: `id`, `name`, `region` (القاهرة الكبرى/الدلتا/الإسكندرية والساحل/القناة وسيناء/الصعيد/خط خاص), `governorates text[]`, `cities text[]`, `assigned_courier_id uuid`, `planned_date date`, `start_time time`, `expected_end_time time`, `status` (draft/planned/in_progress/completed/cancelled), `color`, `notes`, `created_by`, timestamps.

**`route_orders`**: `id`, `route_id`, `order_id` (UNIQUE — طلب في خط واحد فقط داخل الوحدة), `sequence int`, `expected_delivery_at timestamptz`, `added_by`, `added_at`.

**`order_tracking`**: `id`, `order_id` (UNIQUE), `courier_id`, `courier_status` enum (`assigned_to_courier`,`ready_for_pickup_from_main_warehouse`,`picked_up_by_courier`,`out_for_delivery`,`delivered`,`failed_delivery`,`returned_to_warehouse`,`cancelled`), `delivered_at`, `last_updated_by`, timestamps.

**`handovers`**: `order_id` (UNIQUE), `prepared_by`, `prepared_at`, `handed_over_by`, `handed_over_at`, `courier_received_by`, `courier_received_at`, `checklist_confirmed bool`, `notes`.

**`collections`**: `id`, `order_id` (UNIQUE), `amount_due numeric`, `amount_collected numeric`, `status` enum (`cash_collected`,`partial_collected`,`not_collected`,`mismatch`,`paid_online`,`returned_no_collection`), `difference numeric GENERATED`, `notes`, `collected_at`, `collected_by`. **لا يكتب أي شيء على `orders.collection_status` ولا `payment_status`.**

**`failed_attempts`**: `id`, `order_id`, `reason` enum (8 أسباب من المواصفات), `notes` (إجباري), `next_action` enum (`reschedule`,`return_to_warehouse`,`cancel_order`,`manager_review`), `created_by`, `created_at`.

### الصلاحيات (GRANT + RLS)

- GRANT على schema `private_courier` لـ `authenticated` و`service_role`.
- RLS مفعّل على كل الجداول.
- دالة مساعدة `private_courier.is_courier_for_order(order_id)` و`private_courier.has_courier_mgmt_role()` للاستخدام داخل السياسات (SECURITY DEFINER، تستخدم `has_role`).
- السياسات:
  - `private_delivery_rep`: يقرأ/يحدّث **فقط** السجلات المرتبطة بطلباته (عبر `order_tracking.courier_id = auth.uid()` أو `routes.assigned_courier_id = auth.uid()`).
  - المدير العام/التنفيذي/مدير المبيعات: قراءة وكتابة شاملة داخل الوحدة فقط.
  - مشرف المخزن: قراءة + كتابة على `handovers` فقط.
  - المحاسبة: قراءة على `collections` فقط.
  - باقي الأدوار: ممنوع.

> ملاحظة: لن نلمس RLS الخاصة بـ `orders`. عرض بيانات الطلب للمندوب يتم عبر RPC `SECURITY DEFINER` يرجع فقط الحقول المسموح بها للطلبات المرتبطة به.

### RPC جديد (للقراءة الآمنة من orders بدون توسيع RLS)
- `private_courier.list_eligible_orders(filters)` — يرجع الطلبات المؤهلة (private courier من المخزن الرئيسي) للمديرين فقط.
- `private_courier.get_my_assigned_orders()` — يرجع طلبات المندوب الحالي مع بيانات العميل والمنتجات.
- كلاهما SECURITY DEFINER + يتحقق من الدور داخليًا.

---

## 2) المسارات والصفحات الجديدة

كلها تحت prefix `/private-courier/*` (مفصول كليًا عن `/orders` و`/delivery-routes` القديم):

```text
/private-courier                        -> Dashboard (المؤشرات الـ 14 من المواصفات)
/private-courier/planning               -> عرض المدير: الطلبات المؤهلة + إنشاء خطوط + تعيين
/private-courier/routes                 -> إدارة خطوط السير (CRUD)
/private-courier/routes/:id             -> تفاصيل خط + مانيفست قابل للطباعة
/private-courier/my-deliveries          -> شاشة المندوب (مخصصة للموبايل)
/private-courier/handovers              -> شاشة مشرف المخزن للتسليم
/private-courier/collections            -> تقرير التحصيل (محاسبة + مدير)
```

ملفات جديدة فقط:
```text
src/pages/private-courier/Dashboard.tsx
src/pages/private-courier/Planning.tsx
src/pages/private-courier/Routes.tsx
src/pages/private-courier/RouteDetail.tsx
src/pages/private-courier/MyDeliveries.tsx
src/pages/private-courier/Handovers.tsx
src/pages/private-courier/Collections.tsx
src/components/private-courier/RouteCard.tsx
src/components/private-courier/OrderHandoverDialog.tsx
src/components/private-courier/CollectionDialog.tsx
src/components/private-courier/FailedDeliveryDialog.tsx
src/components/private-courier/StatusBadge.tsx
src/hooks/usePrivateCourierData.tsx
src/lib/privateCourier/constants.ts   -- enums، أسباب الفشل، المناطق
src/lib/privateCourier/printManifest.ts -- يستخدم openPrintWindow الحالي
```

تعديلات محدودة جدًا (إضافة فقط، بدون لمس سلوك قائم):
- `src/components/AnimatedRoutes.tsx` — إضافة 7 routes جديدة محمية.
- `src/components/layout/SidebarMenuSections.tsx` — إضافة قسم "المندوب الخاص وخطوط السير" (الصفحة القديمة `/delivery-routes` تبقى كما هي للتوافق).
- `src/components/ProtectedRoute.tsx` — توسيع `PRIVATE_REP_ALLOWED_PREFIXES` ليشمل `/private-courier`.

---

## 3) خريطة الميزات → الجدول/الـ RPC

| ميزة | المصدر |
|---|---|
| Dashboard KPIs الـ14 | aggregate من `order_tracking` + `collections` + RPC eligible |
| قائمة المندوب | RPC `get_my_assigned_orders` + `order_tracking` |
| تخطيط المدير | RPC `list_eligible_orders` + `route_orders` + `routes` |
| تعيين طلب لمندوب | INSERT في `route_orders` + INSERT/UPDATE في `order_tracking` (status=`assigned_to_courier`) |
| تأكيد التسليم من المخزن | UPDATE `handovers` (يقوم به مشرف المخزن والمندوب يؤكد الاستلام) |
| تغيير حالة المندوب | UPDATE `order_tracking.courier_status` |
| تسجيل التحصيل | INSERT/UPSERT في `collections` |
| فشل التوصيل | INSERT في `failed_attempts` + UPDATE حالة التتبع |
| طباعة مانيفست | `printManifest` يستخدم `openPrintWindow` (RTL/Arabic-safe) |

---

## 4) الأمان

- لا يتم منح `anon` أي صلاحية.
- كل الـ RPCs تتحقق من الدور داخلها قبل إرجاع أي بيانات.
- بيانات العملاء (هاتف/عنوان) ترجع فقط للمندوب المعين أو للمديرين.
- لن يتم استخدام `service_role` في أي edge function ضمن هذه الوحدة (كلها client-side عبر RLS/RPC).
- RLS الحالية على `orders`/`customers` تبقى كما هي تمامًا.

---

## 5) الاختبار

- اختبارات `vitest` جديدة:
  - مندوب يرى فقط طلباته.
  - مدير يرى كل الطلبات المؤهلة، لا يرى غير المؤهلة كأنها مؤهلة.
  - تحصيل لا يحدّث `orders.collection_status`.
  - تعيين طلب لا يحدّث `orders.route_id` ولا `orders.status`.
- اختبار يدوي: فتح `/orders` كما هو والتأكد من سلوكه قبل/بعد.

---

## 6) التقرير النهائي (سيُسلَّم بعد التنفيذ)
- الجداول/الـ RPCs/الصفحات التي أضيفت.
- تأكيد عدم تعديل `orders`، المخزون، التسعير، التحصيل، RLS.
- نتائج الاختبارات.
- أي ملاحظات أو تنبيهات من supabase linter.

---

## استفسارات قبل التنفيذ
1. **خط السير الحالي `/delivery-routes`**: أتركه كما هو (للتوافق مع كيمو الآن) أم أخفيه لاحقًا بعد جاهزية الوحدة الجديدة؟
2. **enum الحالة الجديد**: هل مقبول إنشاء enum جديد `private_courier.courier_status` (مستقل عن `orders.status`)؟
3. **التحصيل المنفصل**: تأكيد أن قيمة التحصيل تُسجَّل فقط داخل `private_courier.collections` ولا تنعكس على `orders.payment_status` إطلاقًا حتى بعد `delivered`؟
