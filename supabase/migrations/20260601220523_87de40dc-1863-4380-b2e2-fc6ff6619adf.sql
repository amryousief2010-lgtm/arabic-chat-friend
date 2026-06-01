-- 1) Index user_roles for fast has_role lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role ON public.user_roles(user_id, role);

-- 2) Index orders.shipping_company for the private_delivery_rep policies
CREATE INDEX IF NOT EXISTS idx_orders_shipping_company ON public.orders(shipping_company);

-- 3) Index orders.source_warehouse_id for the Agouza keeper policies
CREATE INDEX IF NOT EXISTS idx_orders_source_warehouse_id ON public.orders(source_warehouse_id);

-- 4) Rewrite order_items policies that scan per row → use IN (SELECT) so Postgres caches the inner set once per query
DROP POLICY IF EXISTS "Sales moderators can view items of their assigned orders" ON public.order_items;
CREATE POLICY "Sales moderators can view items of their assigned orders"
ON public.order_items FOR SELECT
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
  AND order_id IN (
    SELECT o.id FROM public.orders o
    WHERE o.created_by = (SELECT auth.uid())
       OR public.order_matches_moderator((SELECT auth.uid()), o.moderator)
  )
);

DROP POLICY IF EXISTS "Private rep can view own shipping order items" ON public.order_items;
CREATE POLICY "Private rep can view own shipping order items"
ON public.order_items FOR SELECT
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role))
  AND order_id IN (
    SELECT o.id FROM public.orders o WHERE o.shipping_company = 'مندوب خاص'
  )
);

DROP POLICY IF EXISTS "Agouza keeper can view outlet order items" ON public.order_items;
CREATE POLICY "Agouza keeper can view outlet order items"
ON public.order_items FOR SELECT
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'agouza_warehouse_keeper'::app_role))
  AND order_id IN (
    SELECT o.id FROM public.orders o
    JOIN public.warehouses w ON w.id = o.source_warehouse_id
    WHERE w.name LIKE '%العجوزة%'
  )
);

-- 5) Customers: rewrite per-row policies
DROP POLICY IF EXISTS "Private rep can view own shipping customers" ON public.customers;
CREATE POLICY "Private rep can view own shipping customers"
ON public.customers FOR SELECT
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'private_delivery_rep'::app_role))
  AND id IN (
    SELECT o.customer_id FROM public.orders o
    WHERE o.shipping_company = 'مندوب خاص' AND o.customer_id IS NOT NULL
  )
);

DROP POLICY IF EXISTS "Agouza keeper can view outlet customers" ON public.customers;
CREATE POLICY "Agouza keeper can view outlet customers"
ON public.customers FOR SELECT
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'agouza_warehouse_keeper'::app_role))
  AND id IN (
    SELECT o.customer_id FROM public.orders o
    JOIN public.warehouses w ON w.id = o.source_warehouse_id
    WHERE w.name LIKE '%العجوزة%' AND o.customer_id IS NOT NULL
  )
);

-- 6) Wrap remaining has_role/has_any_role calls in (SELECT ...) so they are cached as init plans
DROP POLICY IF EXISTS "Managers and authorized roles can view all customers" ON public.customers;
CREATE POLICY "Managers and authorized roles can view all customers"
ON public.customers FOR SELECT
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])));

DROP POLICY IF EXISTS "Sales moderators can view all customers" ON public.customers;
CREATE POLICY "Sales moderators can view all customers"
ON public.customers FOR SELECT
USING ((SELECT public.has_role((SELECT auth.uid()), 'sales_moderator'::app_role)));

DROP POLICY IF EXISTS "Shipping company can view customers" ON public.customers;
CREATE POLICY "Shipping company can view customers"
ON public.customers FOR SELECT
USING ((SELECT public.has_role((SELECT auth.uid()), 'shipping_company'::app_role)));

DROP POLICY IF EXISTS "Managers and authorized roles can view all order items" ON public.order_items;
CREATE POLICY "Managers and authorized roles can view all order items"
ON public.order_items FOR SELECT
USING ((SELECT public.has_any_role((SELECT auth.uid()), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role, 'accountant'::app_role, 'warehouse_supervisor'::app_role])));

DROP POLICY IF EXISTS "Shipping company can view all order items" ON public.order_items;
CREATE POLICY "Shipping company can view all order items"
ON public.order_items FOR SELECT
USING ((SELECT public.has_role((SELECT auth.uid()), 'shipping_company'::app_role)));