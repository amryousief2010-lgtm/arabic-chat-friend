
ALTER VIEW public.v_stock_reconciliation SET (security_invoker = on);
ALTER VIEW public.v_agouza_readiness SET (security_invoker = on);

REVOKE EXECUTE ON FUNCTION public._recon_assert_manager() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.generate_stock_reconciliation_proposals() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public._recon_transition(uuid, text[], text, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.submit_proposal_for_review(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.approve_proposal_for_future(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.reject_proposal(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.dismiss_proposal(uuid, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.request_proposal_investigation(uuid, text) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.generate_stock_reconciliation_proposals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_proposal_for_review(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_proposal_for_future(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_proposal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_proposal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_proposal_investigation(uuid, text) TO authenticated;
