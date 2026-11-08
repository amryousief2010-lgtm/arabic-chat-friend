-- تراجع قائمة مراجعة الأرقام وتصحيح الحقل.
-- لا يحذف صفوف الطابور ولا يمسّ العملاء أو الطلبات.
-- يبقي دالة الفحص والمشغّل الليليين إن وُجدا من الهجرة السابقة؛ يسقط فقط ما أضافته هذه الهجرة
-- إذا أردت إزالة الفحص بالكامل استخدم تراجع 20261108204500 بعد التأكد أنه مطبَّق.

DROP FUNCTION IF EXISTS public.cm_phone_review_list(date, text, text, int, int);
DROP FUNCTION IF EXISTS public.cm_correct_customer_phone(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.cm_phone_id_set_eq(uuid[], uuid[]);
