
# نسخة العجوزة المستقلة (تجهيز الخط + عهدة الأوردرات + الخزنة)

## الفكرة العامة
عمل طبقة مستقلة لمخزن العجوزة موازية للمخزن الرئيسي، بنفس الوظائف بالظبط لكن ببيانات ومناديب ومنطق منفصل تمامًا — أوردر مسحوب من العجوزة لا يظهر في شاشات الرئيسي والعكس صحيح.

## 1) قاعدة البيانات
الجداول الحالية (courier_goods_custodies / courier_order_assignments / pc_order_tracking / courier_daily_cash_deposits …) ما تحتوي حاليًا على عمود `warehouse_id`. الحل الأنظف والأقل مخاطر:

- إضافة عمود `warehouse_id uuid` على الجداول التالية مع default = ID المخزن الرئيسي (لحفظ التوافق الرجعي مع البيانات القديمة):
  - `courier_goods_custodies`
  - `courier_order_assignments`
  - `pc_order_tracking`
  - `pc_collections`
  - `pc_failed_attempts`
  - `courier_daily_cash_deposits`
  - `courier_daily_cash_deposit_lines`
  - `courier_daily_closures`
  - `delivery_collection_batches`
  - `courier_commission_payouts`
- Backfill لكل الصفوف الموجودة → `warehouse_id = MAIN_WAREHOUSE_ID`.
- Indexes على `(warehouse_id, status)` و `(warehouse_id, opened_at)`.
- تحديث الـ RLS policies المرتبطة عشان تفلتر على `warehouse_id` عند الحاجة (بس بدون كسر الصلاحيات الحالية).

- جدول `courier_profiles` نضيف له عمود `warehouse_id uuid` عشان كل مندوب يبقى تابع لمخزن واحد (رئيسي أو عجوزة). Backfill الحاليين على الرئيسي.

## 2) دور أمين العجوزة والمناديب
- المناديب اللي حيبقى ليهم `warehouse_id = agouza` يظهروا فقط في شاشات العجوزة.
- شاشة إضافة مندوب تتعدل عشان تختار المخزن التابع له.

## 3) المكونات (UI)
- إعادة تصميم 3 مكونات لتقبل prop `warehouseId`:
  - `RouteDistributionPreparationTab({ warehouseId })`
  - `CourierOrderCustodyTab({ warehouseId })`
  - `MainWarehouseTreasuryTab` → إعادة تسميته `WarehouseTreasuryTab({ warehouseId, label })`
- المنطق الداخلي:
  - `getDeliveryKind` يعتمد على `source_warehouse_id === warehouseId` بدل الثابت.
  - كل استعلام على الجداول أعلاه يضيف `.eq("warehouse_id", warehouseId)`.
  - كل insert يمرر `warehouse_id: warehouseId`.
  - RPC calls (لو موجودة) نضيف باراميتر warehouse_id.

## 4) شريط الأدوات في صفحة المخازن
تحديث `AGOUZA_TOOLS` في `src/pages/modules/Warehouses.tsx` ليصبح:
```
[
  { key: "treasury",       label: "خزنة مخزن العجوزة",     Icon: Wallet },
  { key: "courier-orders", label: "عهدة أوردرات مندوب العجوزة", Icon: Truck },
  { key: "route-prep",     label: "تجهيز خط توزيع العجوزة", Icon: Truck },
  { key: "recon",          label: "مطابقة خزنة العجوزة",   Icon: ClipboardCheck },
  { key: "closure",        label: "إقفال يوم العجوزة",     Icon: ClipboardCheck },
  { key: "daily-recon",    label: "تسوية عهدة اليوم",      Icon: ClipboardCheck },
]
```
و `renderAgouzaSubview` يمرر `warehouseId={AGOUZA_WAREHOUSE_ID}` للمكونات الثلاثة.

## 5) خزنة العجوزة الحالية
`AgouzaTreasuryTab` الموجودة حاليًا تعمل على `agouza_warehouse_treasury_txns` وهو منفصل عن `main_warehouse_treasury_txns`. الاقتراح: نستبدلها بنسخة من `MainWarehouseTreasuryTab` (بعد جعلها warehouse-aware) عشان الأمين يشوف نفس الواجهة والمميزات (إيداعات المندوب، ربط بحركات المخزن، طباعة، إلخ) — لكن بجدول العجوزة.

**نقطة تحتاج قرار**: هل نبقى على جدول `agouza_warehouse_treasury_txns` المنفصل، ولا ندمج الاثنين في `main_warehouse_treasury_txns` مع عمود `warehouse_id`؟ الأنظف تقنيًا هو الدمج، لكن يحتاج migration data وأثره أوسع.

## 6) اختبارات
- إضافة مندوب جديد للعجوزة، فتح عهدة، صرف أوردر مسحوب من العجوزة، تحصيل، إيداع في خزنة العجوزة، إقفال.
- التأكد إن نفس الأوردر لا يظهر في شاشات الرئيسي.
- إن أوردرات الرئيسي القديمة والجديدة تفضل تشتغل زي ما هي.

## تقدير الحجم
- Migration واحد كبير (5-10 جداول).
- تعديل 3 مكونات كبيرة (~2000 سطر إجمالاً).
- تعديل صفحة الـ Warehouses وصفحة المناديب.
- خطر عالي لو حصل مسح غلط، عشان كده migration تجريبي أولاً.

## سؤال قبل التنفيذ
هل توافق على المسار ده؟ خصوصًا:
1. إضافة `warehouse_id` للجداول المذكورة بدل ما ننشئ جداول مكررة (agouza_courier_custodies إلخ).
2. جعل كل مندوب تابع لمخزن واحد (main أو agouza).
3. الإبقاء على `agouza_warehouse_treasury_txns` كما هو، ولا دمجه مع `main_warehouse_treasury_txns`؟
