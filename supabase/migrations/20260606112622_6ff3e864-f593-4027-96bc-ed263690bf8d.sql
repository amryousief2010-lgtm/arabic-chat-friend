
DROP POLICY IF EXISTS "Shipping company can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Shipping company can update orders" ON public.orders;

CREATE POLICY "Shipping company can view own-carrier orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'shipping_company'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.shipping_company_name IS NOT NULL
      AND orders.shipping_company = p.shipping_company_name
  )
);

CREATE POLICY "Shipping company can update own-carrier orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'shipping_company'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.shipping_company_name IS NOT NULL
      AND orders.shipping_company = p.shipping_company_name
  )
)
WITH CHECK (
  has_role(auth.uid(), 'shipping_company'::app_role)
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.shipping_company_name IS NOT NULL
      AND orders.shipping_company = p.shipping_company_name
  )
);
