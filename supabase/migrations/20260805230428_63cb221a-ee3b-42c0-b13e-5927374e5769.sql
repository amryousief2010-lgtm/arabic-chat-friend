CREATE TABLE public.payroll_month_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  month int NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month)
);

GRANT SELECT, INSERT ON public.payroll_month_closures TO authenticated;
GRANT ALL ON public.payroll_month_closures TO service_role;
ALTER TABLE public.payroll_month_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales mgmt can view payroll closures" ON public.payroll_month_closures
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "Managers can approve payroll closures" ON public.payroll_month_closures
FOR INSERT TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]) AND approved_by = auth.uid());

CREATE TABLE public.payroll_month_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id uuid NOT NULL REFERENCES public.payroll_month_closures(id) ON DELETE CASCADE,
  year int NOT NULL,
  month int NOT NULL,
  moderator_name text NOT NULL,
  base_salary numeric NOT NULL DEFAULT 0,
  processed_sales numeric NOT NULL DEFAULT 0,
  processed_tier_label text,
  processed_qty numeric NOT NULL DEFAULT 0,
  processed_rate numeric NOT NULL DEFAULT 0,
  processed_bonus numeric NOT NULL DEFAULT 0,
  meat_sales numeric NOT NULL DEFAULT 0,
  meat_tier_label text,
  meat_qty numeric NOT NULL DEFAULT 0,
  meat_rate numeric NOT NULL DEFAULT 0,
  meat_bonus numeric NOT NULL DEFAULT 0,
  bone_qty numeric NOT NULL DEFAULT 0,
  bone_rate numeric NOT NULL DEFAULT 0,
  bone_bonus numeric NOT NULL DEFAULT 0,
  chick_count numeric NOT NULL DEFAULT 0,
  chick_bonus numeric NOT NULL DEFAULT 0,
  total_bonus numeric NOT NULL DEFAULT 0,
  prev_month_bonus numeric NOT NULL DEFAULT 0,
  grand_total numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (year, month, moderator_name)
);

GRANT SELECT, INSERT ON public.payroll_month_snapshots TO authenticated;
GRANT ALL ON public.payroll_month_snapshots TO service_role;
ALTER TABLE public.payroll_month_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales mgmt can view payroll snapshots" ON public.payroll_month_snapshots
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "Managers can insert payroll snapshots" ON public.payroll_month_snapshots
FOR INSERT TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));

CREATE TABLE public.payroll_carried_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number text,
  moderator_name text NOT NULL,
  category text NOT NULL,
  origin_year int NOT NULL,
  origin_month int NOT NULL,
  paid_year int NOT NULL,
  paid_month int NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  rate numeric NOT NULL DEFAULT 0,
  bonus_amount numeric NOT NULL DEFAULT 0,
  delivered_at timestamptz,
  origin_closure_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, category)
);

GRANT SELECT, INSERT ON public.payroll_carried_orders TO authenticated;
GRANT ALL ON public.payroll_carried_orders TO service_role;
ALTER TABLE public.payroll_carried_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sales mgmt can view carried orders" ON public.payroll_carried_orders
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role,'accountant'::app_role,'financial_manager'::app_role]));

CREATE POLICY "Managers can insert carried orders" ON public.payroll_carried_orders
FOR INSERT TO authenticated
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,'marketing_sales_manager'::app_role]));