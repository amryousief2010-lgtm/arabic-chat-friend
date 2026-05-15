
-- جدول أسعار شحن المندوب الخاص
CREATE TABLE IF NOT EXISTS public.private_delivery_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location text NOT NULL UNIQUE,
  governorate text,
  price numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.private_delivery_pricing ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_private_delivery_pricing_updated_at
BEFORE UPDATE ON public.private_delivery_pricing
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- عرض الأسعار: متاح للمندوب الخاص والإدارة والمحاسب
CREATE POLICY "view private delivery pricing"
ON public.private_delivery_pricing FOR SELECT
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,
    'accountant'::app_role,'marketing_sales_manager'::app_role,'private_delivery_rep'::app_role
  ])
);

-- إدخال/تعديل/حذف: الإدارة + المندوب الخاص
CREATE POLICY "manage private delivery pricing"
ON public.private_delivery_pricing FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'private_delivery_rep'::app_role
  ])
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'private_delivery_rep'::app_role
  ])
);

-- ===== RLS للطلبات للمندوب الخاص =====
CREATE POLICY "Private rep can view own shipping orders"
ON public.orders FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(),'private_delivery_rep'::app_role)
  AND shipping_company = 'مندوب خاص'
);

CREATE POLICY "Private rep can update own shipping orders"
ON public.orders FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(),'private_delivery_rep'::app_role)
  AND shipping_company = 'مندوب خاص'
)
WITH CHECK (
  has_role(auth.uid(),'private_delivery_rep'::app_role)
  AND shipping_company = 'مندوب خاص'
);

-- order_items: عرض لطلبات المندوب الخاص
CREATE POLICY "Private rep can view own shipping order items"
ON public.order_items FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(),'private_delivery_rep'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id AND o.shipping_company = 'مندوب خاص'
  )
);

-- customers: عرض عملاء طلباته
CREATE POLICY "Private rep can view own shipping customers"
ON public.customers FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(),'private_delivery_rep'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = customers.id AND o.shipping_company = 'مندوب خاص'
  )
);

-- تعبئة المناطق
INSERT INTO public.private_delivery_pricing (location, governorate, price, notes) VALUES
('ايتاي البارود','البحيرة',110,NULL),
('دمنهور','البحيرة',120,NULL),
('كفر الدوار','البحيرة',0,'بحاجة لتحديد السعر'),
('منيا القمح','الشرقية',120,NULL),
('الزقازيق','الشرقية',90,NULL),
('العاشر من رمضان','الشرقية',120,'الاستلام في الموقف الجديد + عربون قبلها'),
('السنبلاوين','الدقهلية',120,NULL),
('المنصورة','الدقهلية',90,NULL),
('أجا','الدقهلية',90,NULL),
('دقادوس','الدقهلية',90,NULL),
('ميت غمر','الدقهلية',80,NULL),
('بلقاس','الدقهلية',120,NULL),
('نبروه','الدقهلية',120,NULL),
('شربين','الدقهلية',120,NULL),
('كفر الزيات','الغربية',110,NULL),
('طنطا','الغربية',90,NULL),
('سمنود','الغربية',90,NULL),
('زفتى','الغربية',70,NULL),
('السنطة','الغربية',0,'بحاجة لتحديد السعر'),
('المحلة الكبرى','الغربية',0,'بحاجة لتحديد السعر'),
('كفر الشيخ','كفر الشيخ',110,NULL),
('بركة السبع','المنوفية',90,NULL),
('قويسنا','المنوفية',90,NULL),
('شبين الكوم','المنوفية',120,NULL),
('الباجور','المنوفية',120,NULL),
('منوف','المنوفية',120,NULL),
('تلا','المنوفية',120,NULL),
('مدينة السادات','المنوفية',0,'بحاجة لتحديد السعر'),
('طوخ','القليوبية',110,NULL),
('قليوب','القليوبية',120,NULL),
('شبرا الخيمة','القليوبية',120,NULL),
('القناطر الخيرية','القليوبية',120,NULL),
('شبين القناطر','القليوبية',120,NULL),
('بنها','القليوبية',0,'بحاجة لتحديد السعر'),
('الإسماعيلية','الإسماعيلية',0,'بحاجة لتحديد السعر'),
('دمياط','دمياط',0,'بحاجة لتحديد السعر'),
('الإسكندرية','الإسكندرية',0,'بحاجة لتحديد السعر')
ON CONFLICT (location) DO NOTHING;
