CREATE OR REPLACE FUNCTION public.can_approve_agouza(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    public.has_role(_uid, 'general_manager')
    OR public.has_role(_uid, 'executive_manager')
    OR public.has_role(_uid, 'financial_manager')
    OR public.has_role(_uid, 'main_treasury_approver');
$$;