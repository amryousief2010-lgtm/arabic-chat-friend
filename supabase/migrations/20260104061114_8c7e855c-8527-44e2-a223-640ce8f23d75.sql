-- Update the can_edit_product_price function to include sales_manager
CREATE OR REPLACE FUNCTION public.can_edit_product_price(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('general_manager', 'executive_manager', 'sales_manager', 'accountant')
  )
$$;