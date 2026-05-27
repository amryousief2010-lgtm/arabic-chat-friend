# منع تكرار الطلبات لنفس العميل بدون موافقة مديرة التسويق

## الهدف
لو بنت من فريق المبيعات (sales_moderator) حاولت تسجل طلب لعميل (سواء جديد بنفس رقم موجود، أو عميل قائم) ولقت إن فيه بنت تانية سجّلت لنفس العميل طلب فى نفس اليوم، تتمنع من التسجيل لحد ما مديرة التسويق **آلاء حامد** (marketing_sales_manager) توافق.

## التدفّق
1. البنت بتختار العميل (موجود أو بتدخل رقمه فى فورم عميل جديد).
2. عند الضغط على «إنشاء الطلب»:
   - النظام يتأكد: هل فيه طلب من **مستخدم تانى** لنفس `customer_id` فى نفس اليوم (تاريخ القاهرة)؟
   - لو لا → الطلب يكمل عادى.
   - لو فيه → التسجيل يتوقف، وتظهر رسالة + زرار «طلب موافقة من مديرة التسويق».
3. لما تضغط الزرار: يتسجّل صف فى `duplicate_order_approvals` بحالة `pending` ويتبعت إشعار لكل marketing_sales_manager + general_manager.
4. آلاء حامد تفتح صفحة «موافقات تكرار الطلبات» وتختار: قبول / رفض.
5. بعد الموافقة، البنت تقدر تسجل الطلب لنفس العميل فى نفس اليوم (الموافقة سارية 24 ساعة لنفس البنت + نفس العميل). لو اترفض، يظهر سبب الرفض وما تقدرش تسجل.

## التغييرات

### 1. قاعدة البيانات (migration واحدة)
- جدول `duplicate_order_approvals`: `customer_id, requested_by, status, decided_by, decided_at, reason, note, expires_at`.
- GRANT + RLS:
  - sales_moderator: insert/select لطلباته فقط.
  - marketing_sales_manager + general_manager + executive_manager: select الكل + update الحالة.
- function `request_duplicate_order_approval(p_customer_id, p_note)` SECURITY DEFINER:
  - بتنشئ الصف + بتبعت notification لكل marketing_sales_manager + general_manager.
- function `decide_duplicate_order_approval(p_id, p_approve, p_reason)` SECURITY DEFINER لمديرة التسويق/المدير العام.
- function `customer_has_other_order_today(p_customer_id, p_user_id)` بترجع bool (يستخدمها الفرونت والـ trigger).
- function `has_approved_duplicate_order(p_customer_id, p_user_id)`.
- trigger BEFORE INSERT على `orders`: لو الراجل sales_moderator وفيه طلب اليوم من حد تانى ومفيش موافقة سارية → RAISE EXCEPTION برسالة عربى واضحة.

### 2. الفرونت
- `src/pages/NewOrder.tsx`:
  - قبل submit، call RPC `customer_has_other_order_today`. لو true ومفيش موافقة → افتح dialog «يلزم موافقة مديرة التسويق» فيه زرار «اطلب الموافقة».
  - تحت كارت العميل: badge برتقالى لو فيه تكرار اليوم.
  - بعد إرسال الطلب: toast «تم إرسال طلب الموافقة لمديرة التسويق آلاء حامد».
- صفحة جديدة `src/pages/DuplicateOrderApprovals.tsx` لمديرة التسويق:
  - قائمة الطلبات المعلّقة (اسم البنت، اسم/رقم العميل، تاريخ آخر طلب موجود، السبب).
  - أزرار «موافقة» / «رفض» مع حقل ملاحظة.
  - تبويب «تم البت فيها» للأرشيف.
- إضافة الراوت + Sidebar entry لـ marketing_sales_manager + general_manager.

## ملاحظات تقنية
- المقارنة بـ «اليوم» تستخدم تاريخ القاهرة عبر `(timezone('Africa/Cairo', created_at))::date`.
- الموافقة محدودة بـ 24 ساعة وبنفس البنت + نفس العميل، فلو سجّلت مرتين عادى بعد الموافقة لازم تطلب موافقة جديدة لعميل تانى.
- الـ trigger طبقة أمان حتى لو الفرونت اتعدّى.
- الإشعار للمديرة بيستخدم نفس جدول `notifications` (بيتعمل من جوّا SECURITY DEFINER function عشان يتعدى الـ RLS).