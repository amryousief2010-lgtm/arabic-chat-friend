REVOKE ALL ON FUNCTION public.order_items_signature_from_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_items_signature_from_order(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.order_items_summary_from_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_items_summary_from_order(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.find_duplicate_order_candidates(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_duplicate_order_candidates(uuid, text, text, text, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_duplicate_order_attempt(uuid, text, text, text, text, text, jsonb, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.request_duplicate_order_approval(uuid, text, uuid, numeric, jsonb, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_duplicate_order_approval(uuid, text, uuid, numeric, jsonb, jsonb, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.decide_duplicate_order_approval(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_duplicate_order_approval(uuid, boolean, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_duplicate_order_approval_used(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_duplicate_order_approval_used(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.customer_has_other_order_today(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_has_other_order_today(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enforce_duplicate_order_approval() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_duplicate_order_approval() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_potential_duplicate_orders_report(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_potential_duplicate_orders_report(integer) TO authenticated, service_role;