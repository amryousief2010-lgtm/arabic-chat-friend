-- Tighten UPDATE / DELETE on social_media_expenses: managers only, no creator exception.

DROP POLICY IF EXISTS sme_managers_update ON public.social_media_expenses;
DROP POLICY IF EXISTS sme_managers_delete ON public.social_media_expenses;

CREATE POLICY sme_managers_update
ON public.social_media_expenses
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
);

CREATE POLICY sme_managers_delete
ON public.social_media_expenses
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  OR public.has_role(auth.uid(), 'marketing_sales_manager'::app_role)
);