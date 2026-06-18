-- Allow GM / Executive Manager to delete custody expenses
CREATE POLICY custody_exp_mgr_delete ON public.slaughter_custody_expenses
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager'::app_role)
    OR public.has_role(auth.uid(),'executive_manager'::app_role)
  );

-- On delete: cancel any linked HR deduction so it stops affecting the employee's salary
CREATE OR REPLACE FUNCTION public.trg_slaughter_custody_unlink_advance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.hr_deductions
  SET status = 'cancelled',
      notes = COALESCE(notes,'') || E'\nأُلغي تلقائيًا — تم حذف مصروف الخزنة المرتبط (' || OLD.id::text || ')'
  WHERE reference_id = 'treasury_advance_slaughter_custody_expenses_' || OLD.id::text || '_%'
     OR reference_id LIKE 'treasury_advance_slaughter_custody_expenses_' || OLD.id::text || '_%';
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_slaughter_custody_unlink_advance ON public.slaughter_custody_expenses;
CREATE TRIGGER trg_slaughter_custody_unlink_advance
AFTER DELETE ON public.slaughter_custody_expenses
FOR EACH ROW EXECUTE FUNCTION public.trg_slaughter_custody_unlink_advance();