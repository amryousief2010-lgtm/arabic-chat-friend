
-- Allow sales moderators to view orders attributed to them by name (moderator text)
-- even when the order's created_by is a different user (e.g. historical/imported orders).

CREATE OR REPLACE FUNCTION public.normalize_ar(s text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    translate(coalesce(s,''), 'إأآاىة', 'ااااية'),
    '\s+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.order_matches_moderator(_user_id uuid, _moderator_text text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND _moderator_text IS NOT NULL
      AND p.full_name IS NOT NULL
      AND (
        public.normalize_ar(_moderator_text) LIKE '%' || public.normalize_ar(p.full_name) || '%'
        OR public.normalize_ar(p.full_name) LIKE '%' || public.normalize_ar(_moderator_text) || '%'
      )
  );
$$;

DROP POLICY IF EXISTS "Sales moderators can view orders assigned by name" ON public.orders;
CREATE POLICY "Sales moderators can view orders assigned by name"
  ON public.orders FOR SELECT
  USING (
    has_role(auth.uid(), 'sales_moderator'::app_role)
    AND public.order_matches_moderator(auth.uid(), moderator)
  );

-- Also allow viewing order_items for those orders
DROP POLICY IF EXISTS "Sales moderators can view items of their assigned orders" ON public.order_items;
CREATE POLICY "Sales moderators can view items of their assigned orders"
  ON public.order_items FOR SELECT
  USING (
    has_role(auth.uid(), 'sales_moderator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (
          o.created_by = auth.uid()
          OR public.order_matches_moderator(auth.uid(), o.moderator)
        )
    )
  );
