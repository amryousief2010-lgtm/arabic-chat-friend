
-- 1. Discount column
ALTER TABLE public.hatchery_client_invoices
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0;

-- Recreate the generated remaining_amount column (must drop dependent views first)
DROP VIEW IF EXISTS public.v_hatchery_client_balances CASCADE;
DROP VIEW IF EXISTS public.v_hatchery_dashboard_kpis CASCADE;
ALTER TABLE public.hatchery_client_invoices DROP COLUMN IF EXISTS remaining_amount;
ALTER TABLE public.hatchery_client_invoices
  ADD COLUMN remaining_amount numeric
  GENERATED ALWAYS AS (total_amount - paid_amount - discount_amount) STORED;

-- Recreate dependent views
CREATE OR REPLACE VIEW public.v_hatchery_client_balances AS
SELECT c.id AS client_id,
       c.name AS client_name,
       count(i.id) AS invoices_count,
       COALESCE(sum(i.total_amount), 0::numeric)     AS total_amount,
       COALESCE(sum(i.paid_amount), 0::numeric)      AS paid_amount,
       COALESCE(sum(i.discount_amount), 0::numeric)  AS discount_amount,
       COALESCE(sum(i.remaining_amount), 0::numeric) AS remaining_amount
  FROM public.hatch_customers c
  LEFT JOIN public.hatchery_client_invoices i ON i.client_id = c.id
 GROUP BY c.id, c.name;

CREATE OR REPLACE VIEW public.v_hatchery_dashboard_kpis AS
WITH s AS (
  SELECT * FROM public.hatchery_pricing_settings ORDER BY updated_at DESC LIMIT 1
), lots AS (
  SELECT l.*, b.status AS batch_status, b.entry_date
    FROM public.hatchery_batch_lots l
    JOIN public.hatchery_batches b ON b.id = l.batch_id
   WHERE NOT l.cancelled AND b.status <> 'cancelled'
)
SELECT
  (SELECT COALESCE(sum(eggs_in),0)::bigint FROM lots WHERE batch_status IN ('incubating','candled')) AS eggs_in_incubators,
  (SELECT COALESCE(sum(eggs_in),0)::bigint FROM lots WHERE owner_type='capital_ostrich' AND batch_status IN ('incubating','candled')) AS internal_eggs,
  (SELECT COALESCE(sum(eggs_in),0)::bigint FROM lots WHERE owner_type='external_client' AND batch_status IN ('incubating','candled')) AS external_eggs,
  (SELECT count(DISTINCT l.batch_id) FROM lots l, s WHERE l.batch_status='incubating' AND l.candling_recorded_at IS NULL AND (l.entry_date + s.candling_day) <= CURRENT_DATE) AS batches_awaiting_candling,
  (SELECT count(DISTINCT l.batch_id) FROM lots l, s WHERE l.batch_status IN ('incubating','candled') AND l.transferred_to_hatcher_at IS NULL AND (l.entry_date + s.transfer_to_hatcher_day) <= CURRENT_DATE) AS batches_awaiting_hatcher,
  (SELECT COALESCE(sum(transferred_count),0)::bigint FROM lots WHERE batch_status='in_hatcher') AS in_hatcher,
  (SELECT COALESCE(sum(chicks_hatched),0)::bigint FROM lots WHERE brooding_in_at IS NOT NULL AND brooding_out_at IS NULL) AS in_brooding,
  (SELECT COALESCE(sum(chicks_hatched),0)::bigint FROM lots WHERE hatcher_out_at >= date_trunc('month', now())) AS chicks_this_month,
  (SELECT CASE WHEN sum(fertile_eggs) > 0 THEN round(sum(chicks_hatched)::numeric / sum(fertile_eggs)::numeric * 100, 1) ELSE 0 END FROM lots WHERE fertile_eggs IS NOT NULL) AS hatch_rate_pct,
  (SELECT COALESCE(sum(total_amount),0)     FROM public.hatchery_client_invoices) AS invoices_total,
  (SELECT COALESCE(sum(paid_amount),0)      FROM public.hatchery_client_invoices) AS invoices_paid,
  (SELECT COALESCE(sum(discount_amount),0)  FROM public.hatchery_client_invoices) AS invoices_discount,
  (SELECT COALESCE(sum(remaining_amount),0) FROM public.hatchery_client_invoices) AS invoices_remaining;

-- 2. Discounts table
CREATE TABLE IF NOT EXISTS public.hatchery_invoice_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.hatchery_client_invoices(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  notes text,
  approved_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  reference_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hid_invoice_idx ON public.hatchery_invoice_discounts (invoice_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hatchery_invoice_discounts TO authenticated;
GRANT ALL ON public.hatchery_invoice_discounts TO service_role;

ALTER TABLE public.hatchery_invoice_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hid_view" ON public.hatchery_invoice_discounts;
CREATE POLICY "hid_view" ON public.hatchery_invoice_discounts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "hid_manage" ON public.hatchery_invoice_discounts;
CREATE POLICY "hid_manage" ON public.hatchery_invoice_discounts
  FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'hatchery_manager'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'hatchery_manager'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
  );

-- 3. Updated recalculator: considers discounts. Status = paid when (paid + discount) >= total.
CREATE OR REPLACE FUNCTION public.hatchery_recalc_invoice_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_paid numeric; v_disc numeric; v_total numeric; v_inv uuid;
BEGIN
  v_inv := COALESCE(NEW.invoice_id, OLD.invoice_id);
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.hatchery_invoice_payments WHERE invoice_id = v_inv;
  SELECT COALESCE(SUM(amount),0) INTO v_disc FROM public.hatchery_invoice_discounts WHERE invoice_id = v_inv;
  SELECT total_amount INTO v_total FROM public.hatchery_client_invoices WHERE id = v_inv;
  UPDATE public.hatchery_client_invoices SET
    paid_amount = v_paid,
    discount_amount = v_disc,
    payment_status = CASE
      WHEN (v_paid + v_disc) <= 0 THEN 'unpaid'
      WHEN (v_paid + v_disc) >= COALESCE(v_total,0) THEN 'paid'
      ELSE 'partial'
    END
  WHERE id = v_inv;
  RETURN COALESCE(NEW, OLD);
END $function$;

-- 4. Discounts validate + recalc triggers
CREATE OR REPLACE FUNCTION public.hatchery_validate_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_total numeric; v_paid numeric; v_disc_other numeric;
BEGIN
  SELECT total_amount, paid_amount INTO v_total, v_paid
  FROM public.hatchery_client_invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF v_total IS NULL THEN
    RAISE EXCEPTION 'الفاتورة غير موجودة';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_disc_other
    FROM public.hatchery_invoice_discounts
   WHERE invoice_id = NEW.invoice_id AND id <> COALESCE(NEW.id, gen_random_uuid());
  IF (NEW.amount + v_disc_other + v_paid) > v_total + 0.01 THEN
    RAISE EXCEPTION 'لا يسمح بخصم أكبر من المتبقي على الفاتورة';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_hid_validate ON public.hatchery_invoice_discounts;
CREATE TRIGGER trg_hid_validate
  BEFORE INSERT OR UPDATE ON public.hatchery_invoice_discounts
  FOR EACH ROW EXECUTE FUNCTION public.hatchery_validate_discount();

DROP TRIGGER IF EXISTS trg_hid_recalc ON public.hatchery_invoice_discounts;
CREATE TRIGGER trg_hid_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.hatchery_invoice_discounts
  FOR EACH ROW EXECUTE FUNCTION public.hatchery_recalc_invoice_payments();

-- 5. Lab treasury trigger: skip for credit_balance / credit / discount payment methods
CREATE OR REPLACE FUNCTION public.lab_treasury_from_invoice_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_customer text; v_invoice text; v_batch text;
  v_eggs integer; v_ref text; v_desc text; v_id uuid;
BEGIN
  IF NEW.method IN ('credit_balance','credit','discount') THEN
    RETURN NEW;
  END IF;

  SELECT i.client_name_snapshot, i.invoice_no, i.eggs_in, hb.batch_number
    INTO v_customer, v_invoice, v_eggs, v_batch
    FROM public.hatchery_client_invoices i
    LEFT JOIN public.hatchery_batches hb ON hb.id = i.batch_id
   WHERE i.id = NEW.invoice_id;

  v_ref  := 'توريد تفريخ - فاتورة ' || COALESCE(v_invoice,'-')
            || ' - دفعة ' || COALESCE(v_batch,'-')
            || ' - العميل ' || COALESCE(v_customer,'-');
  v_desc := v_ref || COALESCE(' - عدد البيض: ' || v_eggs::text, '');

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category,
    customer_name, units_count, amount, payment_method,
    description, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', COALESCE(NEW.paid_at::date, CURRENT_DATE), 'hatching',
    v_customer, v_eggs, NEW.amount, lab_treasury_map_payment(NEW.method),
    v_desc, NEW.notes, 'pending', COALESCE(NEW.received_by, auth.uid()),
    'hatchery_invoice_payments', NEW.id, v_ref
  )
  ON CONFLICT (source_table, source_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, reason, metadata)
    VALUES ('insert_income', v_id, COALESCE(NEW.received_by, auth.uid()), 'system:trigger',
      'توريد تفريخ — حركة إيراد تلقائية من تحصيل فاتورة',
      jsonb_build_object('source_table','hatchery_invoice_payments','source_id',NEW.id,'invoice',v_invoice,'batch',v_batch));
  END IF;
  RETURN NEW;
END $function$;
