DROP POLICY IF EXISTS "Sales moderators can view items of their assigned orders" ON public.order_items;
CREATE POLICY "Sales moderators can view items of their assigned orders"
ON public.order_items FOR SELECT TO authenticated
USING (
  (SELECT public.has_role((SELECT auth.uid()), 'sales_moderator'::app_role))
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (o.created_by = (SELECT auth.uid())
           OR public.order_matches_moderator((SELECT auth.uid()), o.moderator))
  )
);

DROP POLICY IF EXISTS "Nora can review Hagar order items" ON public.order_items;
CREATE POLICY "Nora can review Hagar order items"
ON public.order_items FOR SELECT TO authenticated
USING (
  public.is_nora_reviewer((SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND public.order_is_hagar(o.moderator, o.created_by)
  )
);