
-- Views: force security_invoker so they respect caller RLS
ALTER VIEW public.v_feed_factory_distribution SET (security_invoker = on);
ALTER VIEW public.v_feed_internal_balances SET (security_invoker = on);
ALTER VIEW public.v_lab_customer_balances SET (security_invoker = on);
ALTER VIEW public.v_lab_treasury_balances SET (security_invoker = on);
ALTER VIEW public.v_main_treasury_balance SET (security_invoker = on);

-- Functions: pin search_path
ALTER FUNCTION public.lab_treasury_advances_touch() SET search_path = public;
ALTER FUNCTION public.tg_internal_messages_set_updated_at() SET search_path = public;
ALTER FUNCTION public.tg_social_media_set_updated_at() SET search_path = public;
