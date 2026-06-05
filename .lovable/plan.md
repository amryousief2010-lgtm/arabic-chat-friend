## خطة تطوير إدارة علف مزرعة الأمهات

### 1. قاعدة البيانات (Migration واحدة)

**جدول `mother_farm_feed_settings`** (صف إعدادات وحيد):
- `bag_weight_kg` (افتراضي 40)
- `daily_consumption_per_bird_kg` (افتراضي 2)
- `low_stock_threshold_kg` (افتراضي 600)
- `current_bird_count` (افتراضي 59)
- `consumption_start_date` (افتراضي 2026-06-06)
- `location_text` (افتراضي: الريف الأوروبي – طريق مصر إسكندرية الصحراوي)

**جدول `mother_farm_feed_movements`**:
- `movement_date` (DATE), `movement_type` (`in` | `daily_consumption` | `adjust_up` | `adjust_down`)
- `bags`, `weight_kg` (موجب دائماً، الإشارة من النوع)
- `supplier`, `notes`, `reason`, `created_by`
- `consumption_day` (DATE, NULL إلا لـ daily_consumption، فريد لمنع التكرار)
- Trigger يحدّث رصيد محسوب أو نعتمد على VIEW

**View `v_mother_farm_feed_balance`**: مجموع الوارد - الاستهلاك - التسوية = الرصيد الحالي + آخر توريد + آخر خصم.

**Function `apply_mother_farm_daily_consumption()`** (SECURITY DEFINER):
- يحسب الأيام من max(consumption_start_date, آخر يوم استهلاك+1) حتى اليوم بتوقيت القاهرة.
- لكل يوم: يدخل حركة `daily_consumption` بـ `current_bird_count × daily_consumption_per_bird_kg` إذا الرصيد كافٍ، وإلا يدخل ما تبقى ويسجل ملاحظة "رصيد غير كافٍ".
- يستخدم unique constraint على `consumption_day` لمنع التكرار.

**RLS & GRANT**:
- العرض: جميع الموظفين المسجلين.
- التعديل (إدراج/تسوية/تعديل إعدادات): general_manager, executive_manager, mother_farm_supervisor (إن وُجد)، warehouse_supervisor.

### 2. الواجهة

**صفحة جديدة** `src/pages/farm/MotherFarmFeed.tsx` (وتبويب داخل لوحة مزرعة الأمهات):
- كروت: الرصيد الحالي/شكاير تقريبية/استهلاك يومي/أيام التغطية/آخر توريد/آخر خصم/الحالة (آمن/منخفض/خطر).
- Banner أحمر + صوت Web Audio API لمرة واحدة عند < 600 كجم، مع زر "تأكيد قراءة".
- زر "إضافة وارد علف" → ديالوج (شكاير أو كيلو، تاريخ، مورد، ملاحظات).
- زر "تسوية رصيد" (+/-) بسبب إجباري.
- جدول سجل الحركات.
- زر "إعدادات" (للأدوار المخوّلة) لتعديل وزن الشيكارة/معدل الاستهلاك/الحد الأدنى/عدد النعام.

**التشغيل التلقائي للخصم اليومي**:
- استدعاء RPC `apply_mother_farm_daily_consumption` تلقائياً عند فتح الصفحة (ولوحة المزرعة).
- يضمن إنشاء حركات الأيام الفائتة بشكل ذرّي.

### 3. الربط بلوحة المزرعة
- إضافة قسم "علف الأمهات" في `MotherFarmDashboard.tsx` يعرض نفس الكروت الرئيسية + التنبيه.

### 4. الاختبار العملي
بعد النشر: إدخال 20 شيكارة (800 كجم) بتاريخ 06-06-2026، تشغيل الخصم التلقائي → التحقق من الرصيد 682 ثم 564 وظهور التنبيه.

### ملاحظات
- لا تأثير على تسجيل البيض اليومي أو شحنات المعمل.
- وزن الشيكارة/الاستهلاك/الحد الأدنى/عدد النعام كلها من جدول الإعدادات وقابلة للتعديل.
- منع الرصيد السالب عبر منطق الـ function.