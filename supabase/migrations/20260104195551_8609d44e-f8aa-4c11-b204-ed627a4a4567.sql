-- =============================================
-- 1. تحديث سياسات جدول العملاء (customers)
-- =============================================

-- حذف السياسة القديمة
DROP POLICY IF EXISTS "Authenticated users can view customers" ON public.customers;

-- المدراء والمحاسب ومشرف المخازن يمكنهم رؤية جميع العملاء
CREATE POLICY "Managers and authorized roles can view all customers"
ON public.customers
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
);

-- مندوب المبيعات يرى فقط العملاء الذين لديه طلبات معهم
CREATE POLICY "Sales moderators can view their customers"
ON public.customers
FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role) 
  AND id IN (
    SELECT customer_id FROM public.orders WHERE created_by = auth.uid()
  )
);

-- =============================================
-- 2. تحديث سياسات جدول الطلبات (orders)
-- =============================================

-- حذف السياسة القديمة
DROP POLICY IF EXISTS "Authenticated users can view orders" ON public.orders;

-- المدراء والمحاسب ومشرف المخازن يمكنهم رؤية جميع الطلبات
CREATE POLICY "Managers and authorized roles can view all orders"
ON public.orders
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
);

-- مندوب المبيعات يرى طلباته فقط
CREATE POLICY "Sales moderators can view their own orders"
ON public.orders
FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role) 
  AND created_by = auth.uid()
);

-- =============================================
-- 3. تحديث سياسات جدول عناصر الطلبات (order_items)
-- =============================================

-- حذف السياسة القديمة
DROP POLICY IF EXISTS "Authenticated users can view order items" ON public.order_items;

-- المدراء والمحاسب ومشرف المخازن يمكنهم رؤية جميع عناصر الطلبات
CREATE POLICY "Managers and authorized roles can view all order items"
ON public.order_items
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
);

-- مندوب المبيعات يرى عناصر طلباته فقط
CREATE POLICY "Sales moderators can view their own order items"
ON public.order_items
FOR SELECT
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role) 
  AND order_id IN (
    SELECT id FROM public.orders WHERE created_by = auth.uid()
  )
);

-- =============================================
-- 4. إضافة سياسة تحديث الطلبات للمندوب (طلباته فقط)
-- =============================================

-- تحديث سياسة التعديل لتسمح للمندوب بتعديل طلباته
DROP POLICY IF EXISTS "Authorized roles can update orders" ON public.orders;

-- المدراء والأدوار المخولة يمكنهم تعديل أي طلب
CREATE POLICY "Managers can update any order"
ON public.orders
FOR UPDATE
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])
);

-- مندوب المبيعات يمكنه تعديل طلباته فقط (الحالة فقط)
CREATE POLICY "Sales moderators can update their own orders"
ON public.orders
FOR UPDATE
USING (
  has_role(auth.uid(), 'sales_moderator'::app_role) 
  AND created_by = auth.uid()
);