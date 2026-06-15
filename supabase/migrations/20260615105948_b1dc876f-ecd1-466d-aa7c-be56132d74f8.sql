
-- ============ Table ============
CREATE TABLE public.hr_employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('national_id_card','work_contract')),
  storage_path text NOT NULL,
  file_name text NOT NULL,
  file_type text,
  file_size bigint,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  uploaded_by uuid REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deactivated_by uuid REFERENCES auth.users(id),
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hr_emp_docs_emp ON public.hr_employee_documents(employee_id, document_type, is_active);

-- Only one active doc per (employee, type)
CREATE UNIQUE INDEX uq_hr_emp_docs_active
  ON public.hr_employee_documents(employee_id, document_type)
  WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employee_documents TO authenticated;
GRANT ALL ON public.hr_employee_documents TO service_role;

ALTER TABLE public.hr_employee_documents ENABLE ROW LEVEL SECURITY;

-- Helper: who can manage HR docs
CREATE OR REPLACE FUNCTION public.can_manage_hr_documents(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_hr_documents(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('general_manager','executive_manager','hr_manager','accountant','financial_manager')
  );
$$;

CREATE POLICY "View HR docs (authorized roles)"
  ON public.hr_employee_documents FOR SELECT TO authenticated
  USING (public.can_view_hr_documents(auth.uid()));

CREATE POLICY "Insert HR docs (managers)"
  ON public.hr_employee_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_hr_documents(auth.uid()));

CREATE POLICY "Update HR docs (managers)"
  ON public.hr_employee_documents FOR UPDATE TO authenticated
  USING (public.can_manage_hr_documents(auth.uid()))
  WITH CHECK (public.can_manage_hr_documents(auth.uid()));

CREATE POLICY "Delete HR docs (managers)"
  ON public.hr_employee_documents FOR DELETE TO authenticated
  USING (public.can_manage_hr_documents(auth.uid()));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_hr_employee_documents_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_hr_emp_docs_updated_at
  BEFORE UPDATE ON public.hr_employee_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_hr_employee_documents_updated_at();

-- ============ Storage policies on bucket 'hr-employee-documents' ============
CREATE POLICY "HR docs storage: read (authorized)"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'hr-employee-documents' AND public.can_view_hr_documents(auth.uid()));

CREATE POLICY "HR docs storage: insert (managers)"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hr-employee-documents' AND public.can_manage_hr_documents(auth.uid()));

CREATE POLICY "HR docs storage: update (managers)"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'hr-employee-documents' AND public.can_manage_hr_documents(auth.uid()))
  WITH CHECK (bucket_id = 'hr-employee-documents' AND public.can_manage_hr_documents(auth.uid()));

CREATE POLICY "HR docs storage: delete (managers)"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'hr-employee-documents' AND public.can_manage_hr_documents(auth.uid()));
