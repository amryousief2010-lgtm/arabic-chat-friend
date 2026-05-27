CREATE OR REPLACE FUNCTION public.customer_has_other_order_today(p_customer_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND (timezone('Africa/Cairo', o.created_at))::date
          = (timezone('Africa/Cairo', now()))::date
      AND COALESCE(o.status,'') <> 'cancelled'
  );
$$;