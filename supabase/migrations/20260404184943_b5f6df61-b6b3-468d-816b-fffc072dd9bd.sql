
-- Fix 1: Replace permissive public INSERT on notifications with authenticated managers-only
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;

CREATE POLICY "Authenticated managers can create notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role
  ])
);

-- Fix 2: Restrict offer_boxes SELECT to authenticated users only
DROP POLICY IF EXISTS "Authenticated users can view offer boxes" ON public.offer_boxes;

CREATE POLICY "Authenticated users can view offer boxes"
ON public.offer_boxes
FOR SELECT
TO authenticated
USING (true);

-- Fix 3: Restrict offer_box_items SELECT to authenticated users only
DROP POLICY IF EXISTS "Authenticated users can view offer box items" ON public.offer_box_items;

CREATE POLICY "Authenticated users can view offer box items"
ON public.offer_box_items
FOR SELECT
TO authenticated
USING (true);

-- Fix 4: Add role check to generate_order_number function
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_number TEXT;
  counter INTEGER;
BEGIN
  IF NOT has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'sales_manager'::app_role,
    'sales_moderator'::app_role
  ]) THEN
    RAISE EXCEPTION 'Not authorized to generate order numbers';
  END IF;
  
  SELECT COUNT(*) + 1 INTO counter FROM public.orders;
  new_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(counter::TEXT, 4, '0');
  RETURN new_number;
END;
$$;
