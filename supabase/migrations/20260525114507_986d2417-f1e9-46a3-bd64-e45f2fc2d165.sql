
REVOKE ALL ON FUNCTION public.fd_meat_persist_lines(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_feed_persist_lines(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_meat_set_fields(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_feed_set_fields(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_meat_edit_consumption_qty(uuid,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_feed_edit_consumption_qty(uuid,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_resolve_meat_finished_item(text,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fd_resolve_feed_finished_item(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fd_meat_persist_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_feed_persist_lines(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_meat_set_fields(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_feed_set_fields(uuid,uuid,uuid,numeric,numeric,numeric,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_meat_edit_consumption_qty(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_feed_edit_consumption_qty(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_resolve_meat_finished_item(text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fd_resolve_feed_finished_item(uuid,uuid) TO authenticated;
