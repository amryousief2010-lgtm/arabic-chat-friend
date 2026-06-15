-- ============================================================
-- HR Module — Phase 1: Employees, Locations, Transfers, Audit
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.hr_employment_type AS ENUM ('monthly', 'daily', 'temporary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.hr_employee_status AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 1) hr_work_locations
-- =========================================================
CREATE TABLE IF NOT EXISTS public.hr_work_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  department text,
  sort_order int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_work_locations TO authenticated;
GRANT ALL ON public.hr_work_locations TO service_role;

ALTER TABLE public.hr_work_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_locations_read_all_authenticated"
  ON public.hr_work_locations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "hr_locations_manage_admins"
  ON public.hr_work_locations FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  );

-- =========================================================
-- 2) hr_employees
-- =========================================================
CREATE TABLE IF NOT EXISTS public.hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text,
  national_id text,
  job_title text,
  department text,
  current_location_id uuid REFERENCES public.hr_work_locations(id) ON DELETE SET NULL,
  employment_type public.hr_employment_type NOT NULL DEFAULT 'monthly',
  base_salary numeric(12,2) NOT NULL DEFAULT 0,
  daily_rate numeric(12,2),
  start_date date,
  status public.hr_employee_status NOT NULL DEFAULT 'active',
  notes text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON public.hr_employees(status);
CREATE INDEX IF NOT EXISTS idx_hr_employees_location ON public.hr_employees(current_location_id);
CREATE INDEX IF NOT EXISTS idx_hr_employees_user ON public.hr_employees(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employees TO authenticated;
GRANT ALL ON public.hr_employees TO service_role;

ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_employees_read_admins"
  ON public.hr_employees FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'financial_manager') OR
    user_id = auth.uid()
  );

CREATE POLICY "hr_employees_manage_admins"
  ON public.hr_employees FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  );

-- =========================================================
-- 3) hr_employee_transfers
-- =========================================================
CREATE TABLE IF NOT EXISTS public.hr_employee_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  from_location_id uuid REFERENCES public.hr_work_locations(id) ON DELETE SET NULL,
  to_location_id uuid NOT NULL REFERENCES public.hr_work_locations(id) ON DELETE RESTRICT,
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text,
  notes text,
  performed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_transfers_employee ON public.hr_employee_transfers(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_transfers_date ON public.hr_employee_transfers(transfer_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employee_transfers TO authenticated;
GRANT ALL ON public.hr_employee_transfers TO service_role;

ALTER TABLE public.hr_employee_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_transfers_read_admins"
  ON public.hr_employee_transfers FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager') OR
    public.has_role(auth.uid(), 'accountant')
  );

CREATE POLICY "hr_transfers_manage_admins"
  ON public.hr_employee_transfers FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  );

-- =========================================================
-- 4) hr_audit_log
-- =========================================================
CREATE TABLE IF NOT EXISTS public.hr_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid,
  employee_id uuid,
  action text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  reason text,
  performed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_audit_employee ON public.hr_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_audit_created ON public.hr_audit_log(created_at DESC);

GRANT SELECT, INSERT ON public.hr_audit_log TO authenticated;
GRANT ALL ON public.hr_audit_log TO service_role;

ALTER TABLE public.hr_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hr_audit_read_admins"
  ON public.hr_audit_log FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager') OR
    public.has_role(auth.uid(), 'executive_manager') OR
    public.has_role(auth.uid(), 'hr_manager')
  );

CREATE POLICY "hr_audit_insert_authenticated"
  ON public.hr_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- =========================================================
-- updated_at triggers
-- =========================================================
CREATE OR REPLACE FUNCTION public.hr_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hr_locations_updated ON public.hr_work_locations;
CREATE TRIGGER trg_hr_locations_updated
  BEFORE UPDATE ON public.hr_work_locations
  FOR EACH ROW EXECUTE FUNCTION public.hr_set_updated_at();

DROP TRIGGER IF EXISTS trg_hr_employees_updated ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_updated
  BEFORE UPDATE ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.hr_set_updated_at();

-- =========================================================
-- Auto-record transfer when current_location_id changes
-- =========================================================
CREATE OR REPLACE FUNCTION public.hr_track_location_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(NEW.current_location_id::text,'') <> COALESCE(OLD.current_location_id::text,'') THEN
    IF NEW.current_location_id IS NOT NULL THEN
      INSERT INTO public.hr_employee_transfers (
        employee_id, from_location_id, to_location_id, transfer_date, reason, performed_by
      ) VALUES (
        NEW.id, OLD.current_location_id, NEW.current_location_id, CURRENT_DATE,
        'تحديث مكان العمل من شاشة الموظف', auth.uid()
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_hr_employees_location_change ON public.hr_employees;
CREATE TRIGGER trg_hr_employees_location_change
  AFTER UPDATE OF current_location_id ON public.hr_employees
  FOR EACH ROW EXECUTE FUNCTION public.hr_track_location_change();

-- =========================================================
-- Seed default work locations
-- =========================================================
INSERT INTO public.hr_work_locations (name, department, sort_order) VALUES
  ('مزرعة الأمهات', 'الإنتاج', 10),
  ('معمل التفريخ', 'الإنتاج', 20),
  ('حضانات التسمين', 'الإنتاج', 30),
  ('المجزر', 'الإنتاج', 40),
  ('مصنع اللحوم', 'الإنتاج', 50),
  ('مصنع العلف', 'الإنتاج', 60),
  ('المخزن الرئيسي', 'المخازن', 70),
  ('فرع العجوزة', 'المخازن', 80),
  ('الإدارة', 'الإدارة', 90),
  ('المبيعات', 'التجاري', 100),
  ('التسويق', 'التجاري', 110),
  ('الحسابات', 'المالية', 120),
  ('أخرى', 'متفرقات', 999)
ON CONFLICT (name) DO NOTHING;
