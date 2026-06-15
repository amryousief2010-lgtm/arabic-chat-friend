
CREATE TABLE IF NOT EXISTS public.hr_employee_name_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_name text NOT NULL,
  normalized_name text NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  source_table text,
  source_id uuid,
  confidence text DEFAULT 'manual',
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hr_alias_unique
  ON public.hr_employee_name_aliases (normalized_name, employee_id, COALESCE(source_table, ''));

CREATE INDEX IF NOT EXISTS hr_alias_norm_idx ON public.hr_employee_name_aliases (normalized_name);
CREATE INDEX IF NOT EXISTS hr_alias_emp_idx ON public.hr_employee_name_aliases (employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employee_name_aliases TO authenticated;
GRANT ALL ON public.hr_employee_name_aliases TO service_role;

ALTER TABLE public.hr_employee_name_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aliases_select_authenticated"
  ON public.hr_employee_name_aliases FOR SELECT TO authenticated USING (true);

CREATE POLICY "aliases_insert_authenticated"
  ON public.hr_employee_name_aliases FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "aliases_update_authenticated"
  ON public.hr_employee_name_aliases FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "aliases_delete_authenticated"
  ON public.hr_employee_name_aliases FOR DELETE TO authenticated USING (true);

CREATE TRIGGER hr_aliases_set_updated_at
  BEFORE UPDATE ON public.hr_employee_name_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
