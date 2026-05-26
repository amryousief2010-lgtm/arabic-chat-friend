# خطة التنفيذ

## 1) الموافقة على طلبات التوريد (مخزن العجوزة ← المخزن الرئيسى)

**يحق له الموافقة/التعديل/الرفض:**
- عبدالهادى علي (warehouse_supervisor)
- أى `general_manager` (عمرو يوسف ×2، waseem)
- أى `executive_manager` (أحمد الجمل)

**التدفق:**
```
العجوزة تطلب → pending_approval → (أى من الـ3) يوافق/يعدّل الكميات/يرفض
   ↓ موافقة                      ↓ رفض
   sent (خصم من الرئيسى)         rejected (سبب الرفض)
   ↓
   received (إضافة لمخزن العجوزة)
```

**Migration:**
- إضافة status: `pending_approval`, `rejected`
- أعمدة جديدة على `warehouse_transfers`: `rejection_reason`, `approved_by`, `approved_at`
- عمود `approved_qty` على `warehouse_transfer_items`
- 3 RPCs: `request_transfer`, `approve_and_send_transfer`, `reject_transfer`
- دالة `can_approve_transfer(uid)` تتحقق من الإيميل أو الدور

**UI:**
- مخزن العجوزة: زر "طلب توريد" + تبويب "طلباتى" بالحالات
- المخزن الرئيسى: تبويب "طلبات بانتظار موافقتى" مع Modal للموافقة/التعديل/الرفض
- إشعارات للطرفين

---

## 2) اختيار مصدر التنفيذ عند إنشاء الأوردر

**عند تسجيل الموديرتور لأوردر عميل → حقل جديد إجبارى "مصدر التنفيذ":**

1. **استلام من مخزن العجوزة** (Pickup - Agouza)
2. **توصيل من منفذ العجوزة** (Delivery - Agouza)
3. **استلام من المخزن الرئيسى** (Pickup - Main)
4. **توصيل من المخزن الرئيسى** (Delivery - Main)

**Migration:**
- عمود `fulfillment_source` على `orders`: enum أو text بأحد القيم الأربعة
- عمود `fulfillment_warehouse_id` (FK → warehouses) محسوب من الاختيار

**خصم المخزون:**
- عند تأكيد الأوردر (status = confirmed/sent) → خصم تلقائى من `warehouse_inventory` للمخزن المختار
- Trigger أو RPC `consume_order_stock(order_id)`
- تسجيل حركة فى `warehouse_movements` بنوع `outbound_order`

**عند نقص المخزون:**
- لو الكمية المتاحة < المطلوبة → إنشاء أمر تلقائى:
  - منتجات اللحوم النيئة → `slaughter_orders` (طلب ذبح)
  - باقى المنتجات المصنّعة → `production_orders` (طلب تصنيع)
- ربط الأمر بالأوردر الأصلى (`source_order_id`)
- إشعار لمدير الإنتاج/الذبح
- الأوردر يدخل حالة "بانتظار التصنيع/الذبح"

---

## 3) واجهات

- **نموذج الأوردر** (`OrderForm`): إضافة Select لمصدر التنفيذ + عرض الاستوك المتاح للمنتج فى المخزن المختار لحظياً + تنبيه أحمر لو فيه نقص
- **تفاصيل الأوردر**: عرض مصدر التنفيذ + الأوامر المرتبطة (إنتاج/ذبح)
- **تبويب فى الإنتاج/الذبح**: أوامر آلية ناتجة من أوردرات العملاء

---

## التفاصيل التقنية

- جميع الـ RPCs `SECURITY DEFINER` + التحقق من الصلاحيات داخلياً
- استخدام `has_role` ودالة `can_approve_transfer` المخصصة
- خصم المخزون داخل Transaction لمنع race conditions
- إشعارات realtime عبر جدول `notifications` الموجود

---

هل أبدأ بتنفيذ الـ Migration (الجزء 1 + 2)؟
