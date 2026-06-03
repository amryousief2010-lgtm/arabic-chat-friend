# خطة تشغيل مصنع اللحوم بشكل عملي

سأبني دورة مصنع اللحوم الكاملة بنفس مستوى مصنع الأعلاف والتحضين، مع اختبار رقمي قبل الانتهاء.

## 1. قاعدة البيانات (Migration واحدة شاملة)

### مخزون مستقل لمصنع اللحوم
- `meat_raw_inventory` — الخامات الغذائية فقط (لحم نعام، بقري، دهن، بصل، فلفل، صويا، أرز، برغل، توابل، ملح، بهارات، عيش حواوشي…). الأعمدة: `code, name_ar, unit, stock, avg_cost, reorder_level, last_movement_at`.
- `meat_packaging_inventory` — مستقل تماماً. يبدأ بـ4 أصناف فقط: علب كفتة / برجر / سجق / كفتة رز. نفس الأعمدة + `product_type` (kofta/burger/sausage/kofta_rice) للربط بالمنتج.
- `meat_finished_inventory` — المنتجات الجاهزة (كفتة، برجر، سجق، مفروم، حواوشي، كفتة رز، برجر جبنة، شاورما، شيش). الأعمدة: `code, name_ar, unit, stock, avg_prod_cost, sale_price, reorder_level`.

### الفواتير
- `meat_raw_purchases` + `meat_raw_purchase_items` — فاتورة شراء خامات. حقول: `supplier, payment_method (cash/credit), treasury_id, status (draft/posted/cancelled), posted_at, posted_by`. منع post مرتين عبر CHECK + trigger.
- `meat_packaging_purchases` + `meat_packaging_purchase_items` — نفس البنية لشراء العلب.
- `meat_manufacturing_orders` + `meat_mfg_raw_lines` + `meat_mfg_packaging_lines` — فاتورة تصنيع بثلاث أقسام (منتج نهائي / خامات غذائية / مواد تعبئة).
- `meat_sales_invoices` + `meat_sales_lines` — بيع، مع `cost_snapshot` لكل سطر لحساب الربح.
- `meat_sales_returns` + `meat_sales_return_lines` — مرتجع مبيعات مع ربط بفاتورة أصلية.
- `meat_to_main_transfers` + `meat_to_main_transfer_lines` — نقل للمخزن الرئيسي. يخصم من `meat_finished_inventory` ويزيد في `inventory_items` للمخزن الرئيسي (warehouse_id = main).

### الخزنة
- `meat_treasury_txns` — حركات الخزنة (IN/OUT) مع `source_type, source_id, ref_no`.

### سجل الحركات الموحد
- `meat_factory_log` — سجل واحد لكل الحركات: شراء خامات، شراء تغليف، تصنيع (3 صفوف: خامات OUT / تغليف OUT / منتج IN)، بيع OUT، مرتجع IN، نقل OUT، حركات خزنة، تسويات. أعمدة: `movement_no (MF-LOG-#####), date, type, direction, item_kind (raw/pack/finished/treasury), item_id, qty, unit, unit_cost, total_value, from_party, to_party, ref_no, linked_id, created_by, status, notes, metadata jsonb`.
- Trigger `prevent_meat_log_mutation` يمنع UPDATE/DELETE بعد posted (مثل brooding_movements).

### Triggers تلقائية
عند post أي فاتورة:
1. تحديث الـinventory المعني (stock + avg_cost بصيغة weighted average للشراء، تكلفة تشغيلة للتصنيع).
2. إدراج صف في `meat_treasury_txns` لو الدفع نقدي.
3. إدراج صفوف في `meat_factory_log`.
4. منع post مرتين (`status = 'posted'` check قبل التحديث).

### الصلاحيات (RLS)
- `meat_factory_operator` role + الـGM/EM. الحذف ممنوع للجميع. الاعتماد متاح للـoperators. الإلغاء/التسوية للـGM/EM فقط.
- منح `has_role(auth.uid(), 'meat_factory_operator')` لأحمد خاطر ومحمد شعله.
- كل CREATE TABLE في public يتبعه GRANT (authenticated + service_role) ثم ENABLE RLS ثم POLICIES.

## 2. الواجهات (UI)

### صفحة موحدة `/meat-factory` مع تبويبات
1. **Dashboard** — كل الكروت المطلوبة (قيمة مخزن خامات، تغليف، جاهز، خزنة، مبيعات اليوم/الشهر/السنة، مشتريات، مرتجعات، صافي، تكلفة المباع، ربح، أعلى/أقل منتج ربحية).
2. **مخزن الخامات الغذائية**
3. **مخزن التغليف** (4 أصناف فقط)
4. **مخزن المنتجات الجاهزة**
5. **فواتير شراء خامات** + Dialog إنشاء/اعتماد + طباعة + Excel
6. **فواتير شراء تغليف** + نفس الشيء
7. **فواتير التصنيع** — Dialog بـ3 أقسام (منتج / خامات / تعبئة)
8. **فواتير البيع** + إنشاء/اعتماد + ربح Snapshot
9. **مرتجع المبيعات**
10. **نقل للمخزن الرئيسي**
11. **الخزنة**
12. **سجل الحركات** — يستخدم `MovementsLog` المُعاد استخدامه

### الطباعة والتصدير
- استخدام `openPrintWindow` من `@/lib/printPdf` لكل المستندات (دعم العربي).
- ترويسة موحدة: "نعام العاصمة - مصنع اللحوم" + نوع المستند + الرقم + التاريخ + المستخدم + الحالة + الجدول + الإجماليات + الملاحظات + التوقيعات.
- Excel عبر `xlsx` لكل تقرير.

### الملفات المتوقعة
- `src/pages/modules/MeatFactory.tsx` (إعادة كتابة مع التبويبات الكاملة)
- `src/components/meat/MeatRawInventory.tsx`
- `src/components/meat/MeatPackagingInventory.tsx`
- `src/components/meat/MeatFinishedInventory.tsx`
- `src/components/meat/MeatRawPurchasesTab.tsx` + Dialog
- `src/components/meat/MeatPackagingPurchasesTab.tsx` + Dialog
- `src/components/meat/MeatManufacturingTab.tsx` + Dialog (3 أقسام)
- `src/components/meat/MeatSalesTab.tsx` + Dialog
- `src/components/meat/MeatSalesReturnsTab.tsx` + Dialog
- `src/components/meat/MeatToMainTransferTab.tsx` + Dialog
- `src/components/meat/MeatTreasuryTab.tsx`
- `src/components/meat/MeatFactoryDashboardTab.tsx`
- `src/lib/meatFactoryPrint.ts` — قوالب الطباعة الموحدة

## 3. البيانات الأولية (Seed)
- 4 أصناف تغليف فقط مع `product_type` المرتبط
- 10 خامات غذائية شائعة برصيد 0
- 9 منتجات جاهزة برصيد 0
- ربط دور `meat_factory_operator` بأحمد خاطر ومحمد شعله

## 4. سيناريو الاختبار (سأنفذه بنفسي بعد البناء)

| # | العملية | قبل | بعد | المخزون | الخزنة | سجل؟ |
|---|---|---|---|---|---|---|
| 1 | شراء 50 كجم لحم نعام نقدي @ 200ج | 0 / 5000ج | 50 / 4000ج | +50 | -1000 | نعم |
| 2 | شراء 20 كجم بقري آجل @ 300ج | 0 | 20 | +20 | 0 | نعم |
| 3 | شراء 100 علبة كفتة نقدي @ 3ج | 0 / 4000 | 100 / 3700 | +100 | -300 | نعم |
| 4 | تصنيع 20 كجم كفتة (5 كجم نعام + 30 علبة) | جاهز 0 | جاهز 20 | -5 نعام، -30 علبة، +20 كفتة | 0 | نعم (3 صفوف) |
| 5 | بيع 10 كجم كفتة نقدي @ 350ج | 20 / 3700 | 10 / 7200 | -10 | +3500 | نعم + ربح snapshot |
| 6 | بيع 5 كجم آجل @ 350ج | 10 | 5 | -5 | 0 | نعم |
| 7 | مرتجع 2 كجم من فاتورة 5 | 5 / 7200 | 7 / 6500 | +2 | -700 | نعم |
| 8 | نقل 3 كجم للمخزن الرئيسي | 7 | 4 | -3 من اللحوم / +3 رئيسي | 0 | نعم في الطرفين |
| 9 | محاولة post نفس فاتورة الشراء مرتين | — | خطأ "already posted" | — | — | — |

سأطبع نتائج كل خطوة بالأرقام الفعلية من DB، وأتحقق من ظهور Dashboard وعمل أزرار الطباعة والـExcel.

## 5. خارج النطاق (متعمد)
- لا أكياس فاكيوم/استيكرات/شنط طلبات في تغليف اللحوم (تأجيل).
- لا تغيير على مصنع الأعلاف أو التحضين.
- لا حذف بيانات قائمة في `meat_factory_*` الموجودة — جداول جديدة بأسماء مختلفة (`meat_raw_*` للمخزن الجديد الموحّد) لتجنب الكسر.

## 6. ملاحظة تقنية
الجداول الموجودة `meat_factory_*` كثيرة ومتشعبة (raw_materials, products, purchases, sales, manufacturing…) لكنها غير مكتملة الدورة. الخطة تبني **layer جديد نظيف** فوقها يربط بشكل قاطع: خامات ↔ تغليف ↔ تصنيع ↔ جاهز ↔ بيع ↔ خزنة ↔ سجل، بدون لمس الجداول القديمة (تبقى للقراءة فقط حتى نقرر هجرتها لاحقاً).

هل أبدأ التنفيذ؟