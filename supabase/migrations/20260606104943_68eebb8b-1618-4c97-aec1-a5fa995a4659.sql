
CREATE TABLE public.lab_treasury_historical_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid')),
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_historical_receivables TO authenticated;
GRANT ALL ON public.lab_treasury_historical_receivables TO service_role;
ALTER TABLE public.lab_treasury_historical_receivables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "htr_read" ON public.lab_treasury_historical_receivables FOR SELECT TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'lab_treasury_keeper') OR has_role(auth.uid(),'lab_treasury_approver')
  OR has_role(auth.uid(),'lab_external_collector')
  OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'slaughterhouse_custody_keeper'));
CREATE POLICY "htr_write" ON public.lab_treasury_historical_receivables FOR ALL TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'lab_treasury_approver'))
WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'lab_treasury_approver'));

CREATE TABLE public.lab_treasury_historical_receivable_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES public.lab_treasury_historical_receivables(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  description text NOT NULL,
  amount numeric(14,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_historical_receivable_items TO authenticated;
GRANT ALL ON public.lab_treasury_historical_receivable_items TO service_role;
ALTER TABLE public.lab_treasury_historical_receivable_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "htri_read" ON public.lab_treasury_historical_receivable_items FOR SELECT TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'lab_treasury_keeper') OR has_role(auth.uid(),'lab_treasury_approver')
  OR has_role(auth.uid(),'lab_external_collector')
  OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'slaughterhouse_custody_keeper'));
CREATE POLICY "htri_write" ON public.lab_treasury_historical_receivable_items FOR ALL TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'lab_treasury_approver'))
WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'lab_treasury_approver'));
CREATE INDEX htri_receivable_idx ON public.lab_treasury_historical_receivable_items(receivable_id);

CREATE TABLE public.lab_treasury_historical_receivable_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receivable_id uuid NOT NULL REFERENCES public.lab_treasury_historical_receivables(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  settlement_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  lab_movement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_treasury_historical_receivable_settlements TO authenticated;
GRANT ALL ON public.lab_treasury_historical_receivable_settlements TO service_role;
ALTER TABLE public.lab_treasury_historical_receivable_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "htrs_read" ON public.lab_treasury_historical_receivable_settlements FOR SELECT TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'lab_treasury_keeper') OR has_role(auth.uid(),'lab_treasury_approver')
  OR has_role(auth.uid(),'lab_external_collector')
  OR has_role(auth.uid(),'slaughterhouse_manager') OR has_role(auth.uid(),'slaughterhouse_custody_keeper'));
CREATE POLICY "htrs_insert" ON public.lab_treasury_historical_receivable_settlements FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
  OR has_role(auth.uid(),'lab_treasury_keeper') OR has_role(auth.uid(),'lab_treasury_approver'));
CREATE POLICY "htrs_update" ON public.lab_treasury_historical_receivable_settlements FOR UPDATE TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'lab_treasury_approver'))
WITH CHECK (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager') OR has_role(auth.uid(),'lab_treasury_approver'));
CREATE POLICY "htrs_delete" ON public.lab_treasury_historical_receivable_settlements FOR DELETE TO authenticated
USING (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager'));
CREATE INDEX htrs_receivable_idx ON public.lab_treasury_historical_receivable_settlements(receivable_id);

CREATE OR REPLACE FUNCTION public.lab_htr_recalc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; paid numeric; tot numeric; st text;
BEGIN
  rid := COALESCE(NEW.receivable_id, OLD.receivable_id);
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.lab_treasury_historical_receivable_settlements
    WHERE receivable_id = rid AND status='approved';
  SELECT total_amount INTO tot FROM public.lab_treasury_historical_receivables WHERE id=rid;
  IF paid <= 0 THEN st := 'unpaid';
  ELSIF paid < tot THEN st := 'partial';
  ELSE st := 'paid'; END IF;
  UPDATE public.lab_treasury_historical_receivables
    SET paid_amount = paid, status = st, updated_at = now() WHERE id = rid;
  RETURN NULL;
END$$;
CREATE TRIGGER trg_lab_htr_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.lab_treasury_historical_receivable_settlements
FOR EACH ROW EXECUTE FUNCTION public.lab_htr_recalc();

WITH ins AS (
  INSERT INTO public.lab_treasury_historical_receivables (title, total_amount, note)
  VALUES ('مستحقات خزنة المعمل عند المجزر', 69195, 'دين شعلة = 1,400 جنيه')
  RETURNING id
)
INSERT INTO public.lab_treasury_historical_receivable_items (receivable_id, entry_date, description, amount)
SELECT ins.id, v.dt::date, v.descr, v.amt FROM ins,
(VALUES
  ('2026-05-17','شراء غدا للعمال',610),
  ('2026-05-18','شراء غدا للعمال',610),
  ('2026-05-20','بداية عهدة شعلة',45),
  ('2026-05-20','شراء غدا للعمال',360),
  ('2026-05-21','فرشة للدهان',30),
  ('2026-05-23','شراء أكياس للمحلات',160),
  ('2026-05-22','شراء غدا لعمال السباكة + 2 كانز',320),
  ('2026-05-22','فطار لعامل',20),
  ('2026-05-24','عهدة / أحمد الجمل متحولين كاش',3050),
  ('2026-05-24','عهدة شعلة',15000),
  ('2026-05-25','عهدة شعلة — حساب محمد جاد',40000),
  ('2026-05-26','عهدة / أحمد الجمل متحولين كاش',5000),
  ('2026-05-26','غسيل سيارة',200),
  ('2026-05-29','شراء أدوات سباكة',1950),
  ('2026-05-28','جاز للسيارة',200),
  ('2026-05-29','وجبات لعمال السباكة',240),
  ('2026-05-29','باقي حساب السباك',1500),
  ('2026-06-02','عهدة شعلة، إيراد تفريخ أحمد واكد متحولين على الكاش',1100),
  ('2026-06-04','وجبات لعمال الدهان',200)
) AS v(dt, descr, amt);
