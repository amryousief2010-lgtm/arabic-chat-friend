-- 1) Add mixed-payment breakdown columns to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS vodafone_cash_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS instapay_amount     numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_amount         numeric(12,2) NOT NULL DEFAULT 0;

-- 2) Enforce sum only when collection_method = 'mixed_payment'
CREATE OR REPLACE FUNCTION public.validate_mixed_payment_breakdown()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s numeric(14,2);
  t numeric(14,2);
BEGIN
  IF NEW.collection_method = 'mixed_payment' THEN
    s := COALESCE(NEW.courier_cash_due,0)
       + COALESCE(NEW.vodafone_cash_amount,0)
       + COALESCE(NEW.instapay_amount,0)
       + COALESCE(NEW.free_amount,0);
    t := COALESCE(NEW.total,0);
    IF abs(s - t) > 0.01 THEN
      RAISE EXCEPTION 'مجموع مبالغ التحصيل (%.2f) لا يساوي قيمة الأوردر (%.2f)', s, t;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mixed_payment_breakdown ON public.orders;
CREATE TRIGGER trg_validate_mixed_payment_breakdown
BEFORE INSERT OR UPDATE OF collection_method, courier_cash_due, vodafone_cash_amount, instapay_amount, free_amount, total
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.validate_mixed_payment_breakdown();

-- 3) Audit log for breakdown edits
CREATE TABLE IF NOT EXISTS public.order_payment_breakdown_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  old_collection_method text,
  new_collection_method text,
  old_cash_amount numeric(12,2),
  new_cash_amount numeric(12,2),
  old_vodafone_cash_amount numeric(12,2),
  new_vodafone_cash_amount numeric(12,2),
  old_instapay_amount numeric(12,2),
  new_instapay_amount numeric(12,2),
  old_free_amount numeric(12,2),
  new_free_amount numeric(12,2),
  note text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.order_payment_breakdown_audit TO authenticated;
GRANT ALL ON public.order_payment_breakdown_audit TO service_role;

ALTER TABLE public.order_payment_breakdown_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY opba_managers_read
ON public.order_payment_breakdown_audit
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'general_manager'::app_role)
  OR public.has_role(auth.uid(), 'executive_manager'::app_role)
  OR public.has_role(auth.uid(), 'sales_manager'::app_role)
  OR public.has_role(auth.uid(), 'warehouse_supervisor'::app_role)
  OR public.has_role(auth.uid(), 'accountant'::app_role)
);

CREATE POLICY opba_insert_by_authenticated
ON public.order_payment_breakdown_audit
FOR INSERT
TO authenticated
WITH CHECK (changed_by = auth.uid());

CREATE INDEX IF NOT EXISTS opba_order_id_idx ON public.order_payment_breakdown_audit (order_id, changed_at DESC);