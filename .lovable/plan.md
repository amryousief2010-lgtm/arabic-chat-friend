# لوحة تحكم المدير التنفيذي

صفحة واحدة سريعة تجمع ملخصات كل الأقسام للمدير التنفيذي والمدير العام فقط.

## الصلاحية
- يظهر الرابط ولوحة التحكم فقط لأدوار: `general_manager` و `executive_manager`.
- باقي المستخدمين لا يرون الرابط ولا يستطيعون فتح الصفحة (Redirect).

## المسار والقائمة
- مسار جديد: `/executive-dashboard`
- لينك في الشريط الجانبي بأعلى القائمة باسم: **لوحة تحكم المدير التنفيذي** بأيقونة مميزة.

## الفلاتر العلوية
- اليوم / الأسبوع / الشهر / السنة / من-إلى (Date range).
- الفلتر يُمرَّر إلى RPC واحد ويُعاد حساب كل الكروت.

## الأقسام المعروضة (كروت مختصرة + زر "عرض التفاصيل" يذهب لـ Dashboard القسم)

1. **مزرعة الأمهات** — إنتاج البيض (يوم/أسبوع/شهر)، أعلى وأقل ملعب، نسبة الهالك، البيض المنقول للتفريخ.
2. **معمل التفريخ** — عملاء، بيض داخل، بيض داخل الماكينات، دفعات حالية، أقرب فقس، كتاكيت نعام العاصمة (شهر/سنة)، نسبة الإخصاب، رصيد الخزنة، صافي الربح.
3. **التحضين والتسمين** — عدد الكتاكيت، التكلفة، القيمة السوقية، الربح المتوقع، النافق ونسبته، رصيد العلف، تكلفة العلف، أقرب دفعة للمجزر.
4. **مصنع الأعلاف** — مخزون العلف الجاهز وقيمته، مبيعات/مشتريات اليوم والشهر، مرتجعات، رصيد الخزنة، صافي الربح، تنبيهات نقص.
5. **مصنع اللحوم** — قيمة الخامات والتغليف والمنتجات الجاهزة، مبيعات/مشتريات اليوم والشهر، مرتجعات، رصيد الخزنة، ربح الشهر، آخر أوامر التصنيع، منتجات تحت الحد الأدنى.
6. **المخزن الرئيسي** — قيمة المخزون، الوارد/الصادر اليوم، التحويلات، المرتجعات، تحت الحد الأدنى، الطلبات المحجوزة.
7. **المبيعات العامة** — مبيعات اليوم/الشهر/السنة، عدد الطلبات، أعلى منتج، أعلى قناة، مرتجعات، صافي المبيعات.
8. **الخزن** — أرصدة كل الخزن (أعلاف/لحوم/تفريخ)، إجمالي النقد، داخل/خارج اليوم.
9. **التنبيهات** — قسم تنبيهات مدمج: أقل ملعب، دفعات قريبة من الفقس/المجزر، نقص علف وخامات وتغليف، خزن سالبة، نافق مرتفع، فواتير آجلة مستحقة.

## التصميم
- شبكة كروت ملونة (لون مميز لكل قسم باستخدام design tokens).
- KPI كبيرة بأرقام عربية، شارات اتجاه (▲/▼) عند توفر مقارنة.
- زر "عرض التفاصيل" على رأس كل قسم → الراوت الموجود حاليًا للقسم.
- شريط تنبيهات بألوان warning/destructive في الأعلى.
- Responsive: 1 عمود موبايل، 2 تابلت، 3 ديسكتوب.
- Skeleton loaders للتحميل السريع.

## الجانب التقني

### RPC مجمّع
دالة `public.executive_dashboard_summary(p_from timestamptz, p_to timestamptz)` تُرجِع JSON واحد يحوي كل الأقسام:
```json
{ "mother_farm": {...}, "hatchery": {...}, "brooding": {...},
  "feed_factory": {...}, "meat_factory": {...}, "main_warehouse": {...},
  "sales": {...}, "treasuries": {...}, "alerts": [...] }
```
- داخل الدالة استعلامات Aggregate خفيفة فقط (COUNT/SUM) على الجداول الموجودة:
  - `farm_egg_production`, `farm_egg_waste`, `farm_to_hatchery_shipments`
  - `hatch_batches`, `hatch_customers`, `feed_factory_treasury_txns` (للتفريخ إن وجد)
  - `brooding_batches`, `brooding_mortality`, `brooding_feed_inventory`, `brooding_to_slaughter_transfers`, `brooding_market_prices`
  - `feed_products`, `feed_sales`, `feed_raw_purchases`, `feed_sales_returns`, `feed_factory_treasury_txns`
  - `meat_raw_inventory`, `meat_packaging_inventory`, `meat_finished_inventory`, `mf_sales`, `mf_raw_purchases`, `mf_pack_purchases`, `mf_returns`, `mf_treasury`, `mf_manufacturing`, `mf_log`
  - `inventory_items`, `inventory_movements`
  - `orders`, `order_items`, `products`
- `SECURITY DEFINER` + `SET search_path = public` + GRANT EXECUTE للأدوار authenticated، مع فحص الدور داخليًا (raise exception لو ليس general/executive manager).

### واجهة
- ملف جديد: `src/pages/ExecutiveDashboard.tsx`
- مكونات: `src/components/executive/SectionCard.tsx`, `KpiTile.tsx`, `AlertsPanel.tsx`, `RangeFilter.tsx`
- React Query: `useQuery(['exec-summary', range], ...)` مع `staleTime: 60s`
- تسجيل الراوت في `src/components/AnimatedRoutes.tsx` مع حارس صلاحية
- إضافة لينك في `src/components/layout/SidebarMenuSections.tsx` مشروط بالدور

### اختبار
- تنفيذ الـ RPC مباشرة على القاعدة والتحقق من ظهور جميع المفاتيح بأرقام معقولة.
- التحقق من أن المستخدم بدور `moderator` يُرفض.
- التحقق من فتح كل زر "تفاصيل" للراوت الصحيح.
- التحقق من تطبيق فلتر التاريخ على المبيعات/المشتريات/الإنتاج.

## ملاحظات
- لن أعدّل أي بيانات أو منطق تشغيل قائم؛ هذه صفحة قراءة فقط.
- لن أنشئ Views جديدة دائمة لتجنّب تعقيد الصلاحيات؛ كل شيء داخل RPC واحد.

هل أبدأ التنفيذ؟
