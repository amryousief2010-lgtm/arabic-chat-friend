## الهدف
لما نرفع شيت بوسطة ونلاقي شحنات بموبايلات مش موجودة في العملاء (يعني البنات سجلوها على بوسطة ومسجلوهاش على السيستم)، السيستم يحفظها في قائمة انتظار، تظهر للبنات كـ **مهام تسجيل ناقصة**، ولما البنت تسجل العميل + الأوردر، الشحنة تتحسب delivered تلقائي وتتشال من القائمة.

## الخطوات

### 1. جدول جديد `unregistered_bostta_shipments`
يخزّن كل شحنة من الشيت ماتلاقيلهاش أوردر:
- `bill_no` (unique) — رقم البوليصة
- `phone`, `customer_name`, `cod`, `shipment_date`, `raw_products`, `parsed_items` (jsonb)
- `status`: `pending` / `registered` / `dismissed`
- `uploaded_from_filename`, `uploaded_by`, `registered_order_id`, `registered_by`, `registered_at`, `dismissed_reason`

### 2. تعديل الـ Edge Function `process-bostta-delivery`
لما شحنة تطلع `phone_not_in_customers`:
- بدل ما نتجاهلها، نـ upsert في `unregistered_bostta_shipments` (بالـ bill_no)
- الـ status الافتراضي `pending`
- ترجع للـ UI كـ "محتاجة تسجيل" مش "unmatched نهائي"

### 3. صفحة/تبويب جديد **"شحنات محتاجة تسجيل"**
مكانها: نفس صفحة `/modules/warehouses` أو تبويب في صفحة الأوردرات، تعرض:
- كل الشحنات `pending`
- لكل شحنة: زر **"سجّل الأوردر"** يفتح فورم أوردر جديد مبدأياً معبّي بـ (الاسم/الموبايل/COD/المنتجات المفكوكة من الشيت)
- زر **"تجاهُل"** (لو مثلاً شحنة ملغية) → `dismissed`
- Badge على التبويب بعدد الـ pending

### 4. لما البنت تسجل الأوردر من الفورم ده
- ينشئ customer جديد (لو ماكانش موجود بالموبايل ده) + order (delivered فوراً + خصم استوك العجوزة)
- يعلّم الشحنة `registered` ويربطها بالـ `registered_order_id`
- تختفي من قائمة الـ pending

### 5. تحديث الـ Review Dialog للـ Upload
- تاب رابع "محتاجة تسجيل" بدل ما يكونوا في "متجاهَل"
- توضّح إن دي مش خطأ، دي مهمة للبنات

## تفاصيل تقنية

- **Table:** `public.unregistered_bostta_shipments` + RLS للـ authenticated (نفس صلاحيات Agouza fulfillment)
- **Uniqueness:** `bill_no` unique — عشان رفع نفس الشيت مرتين ما يعملش تكرار
- **Auto-resolve:** كل مرة نرفع شيت جديد، لو شحنة `pending` بقى ليها order فعلاً في السيستم (بعد ما البنت سجلته) → تتعلّم `registered` تلقائي
- **RBAC:** التسجيل مسموح للـ Moderator / Warehouse / Manager / GM
- **Notification:** إشعار real-time للـ Moderators لما شحنات pending تتضاف

## ملفات هتتعمل / تتعدل

- Migration: `unregistered_bostta_shipments` + RLS + trigger
- `supabase/functions/process-bostta-delivery/index.ts` — تعديل السلوك على phone_not_in_customers
- `src/pages/warehouses/UnregisteredShipmentsTab.tsx` (جديد)
- `src/components/warehouses/RegisterMissingOrderDialog.tsx` (جديد) — فورم التسجيل
- `src/components/warehouses/BulkDeliveryReviewDialog` — تاب "محتاجة تسجيل" بدل "متجاهَل"
- إشعار real-time (استخدام `notifications` الموجود)
