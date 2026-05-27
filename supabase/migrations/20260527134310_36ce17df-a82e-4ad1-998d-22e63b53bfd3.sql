CREATE OR REPLACE FUNCTION public.customer_has_other_order_today(p_customer_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND o.created_by IS DISTINCT FROM p_user_id
      AND o.created_at > now() - interval '24 hours'
      AND COALESCE(o.status,'') <> 'cancelled'
  );
$$;