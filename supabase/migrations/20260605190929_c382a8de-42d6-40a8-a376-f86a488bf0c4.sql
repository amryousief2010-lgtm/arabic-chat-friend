
-- 1) Source linkage columns on lab_treasury_movements
ALTER TABLE public.lab_treasury_movements
  ADD COLUMN IF NOT EXISTS source_table text,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS source_ref text;

-- Unique link: prevent duplicate auto-created movement per source row
CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_treasury_source
  ON public.lab_treasury_movements (source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lab_treasury_source
  ON public.lab_treasury_movements (source_table, source_id);

-- 2) Add payment_method to hatch_customer_payments (backward compatible)
ALTER TABLE public.hatch_customer_payments
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash';

-- 3) Helper: map a free-text payment method to enum
CREATE OR REPLACE FUNCTION public.lab_treasury_map_payment(p text)
RETURNS lab_treasury_payment_method
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p IS NULL THEN 'cash'::lab_treasury_payment_method
    WHEN lower(p) IN ('cash','نقدي','نقدى','نقد') THEN 'cash'::lab_treasury_payment_method
    WHEN lower(p) IN ('vodafone_cash','vodafone','فودافون','فودافون كاش') THEN 'vodafone_cash'::lab_treasury_payment_method
    WHEN lower(p) IN ('instapay','إنستا باي','انستا باي','انستاباي') THEN 'instapay'::lab_treasury_payment_method
    WHEN lower(p) IN ('bank_transfer','bank','تحويل','تحويل بنكي','بنك') THEN 'bank_transfer'::lab_treasury_payment_method
    ELSE 'cash'::lab_treasury_payment_method
  END;
$$;

-- 4) Trigger: auto-create treasury income when hatch_customer_payments inserted
CREATE OR REPLACE FUNCTION public.lab_treasury_from_hatch_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer text;
  v_ref text;
  v_id uuid;
BEGIN
  SELECT name INTO v_customer FROM public.hatch_customers WHERE id = NEW.customer_id;
  v_ref := 'تحصيل عميل تفريخ #' || substr(NEW.id::text, 1, 8);
  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category,
    customer_name, amount, payment_method,
    description, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', NEW.payment_date, 'hatching',
    v_customer, NEW.amount, lab_treasury_map_payment(NEW.payment_method),
    v_ref, NEW.notes, 'pending', COALESCE(NEW.created_by, auth.uid()),
    'hatch_customer_payments', NEW.id, v_ref
  )
  ON CONFLICT (source_table, source_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, reason, metadata)
    VALUES ('insert_income', v_id, COALESCE(NEW.created_by, auth.uid()), 'system:trigger',
      'تم إنشاء حركة إيراد تلقائيًا من تحصيل عميل تفريخ',
      jsonb_build_object('source_table','hatch_customer_payments','source_id',NEW.id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lab_treasury_from_hatch_payment ON public.hatch_customer_payments;
CREATE TRIGGER trg_lab_treasury_from_hatch_payment
  AFTER INSERT ON public.hatch_customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_from_hatch_payment();

-- 5) Trigger: auto-create treasury income when hatchery_invoice_payments inserted
CREATE OR REPLACE FUNCTION public.lab_treasury_from_invoice_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer text;
  v_invoice text;
  v_batch text;
  v_ref text;
  v_eggs integer;
  v_desc text;
  v_id uuid;
BEGIN
  SELECT i.client_name_snapshot, i.invoice_no, i.eggs_in,
         (SELECT batch_number FROM public.hatch_batches WHERE id = i.batch_id)
  INTO v_customer, v_invoice, v_eggs, v_batch
  FROM public.hatchery_client_invoices i WHERE i.id = NEW.invoice_id;

  v_ref := 'تحصيل فاتورة ' || COALESCE(v_invoice,'') || ' - دفعة ' || COALESCE(v_batch,'');
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
      'تم إنشاء حركة إيراد تلقائيًا من تحصيل فاتورة تفريخ',
      jsonb_build_object('source_table','hatchery_invoice_payments','source_id',NEW.id,'invoice',v_invoice));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lab_treasury_from_invoice_payment ON public.hatchery_invoice_payments;
CREATE TRIGGER trg_lab_treasury_from_invoice_payment
  AFTER INSERT ON public.hatchery_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_from_invoice_payment();

-- 6) Trigger: auto-create treasury income when brooding_chick_sales inserted
CREATE OR REPLACE FUNCTION public.lab_treasury_from_chick_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch text;
  v_ref text;
  v_desc text;
  v_id uuid;
BEGIN
  -- brooding_batches likely have batch_number; fall back to id
  BEGIN
    EXECUTE 'SELECT batch_number FROM public.brooding_batches WHERE id = $1'
      INTO v_batch USING NEW.batch_id;
  EXCEPTION WHEN OTHERS THEN v_batch := NULL;
  END;
  v_ref := 'بيع كتاكيت - دفعة ' || COALESCE(v_batch, substr(NEW.batch_id::text,1,8));
  v_desc := v_ref
    || ' - عدد: ' || NEW.count::text
    || ' × ' || NEW.unit_price::text;

  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, income_category,
    customer_name, units_count, unit_price, amount, payment_method,
    description, notes, status, created_by,
    source_table, source_id, source_ref
  ) VALUES (
    'income', NEW.sale_date, 'chick_sales',
    NEW.customer_name, NEW.count, NEW.unit_price, NEW.total_amount,
    lab_treasury_map_payment(NEW.payment_method),
    v_desc, NEW.notes, 'pending', COALESCE(NEW.created_by, auth.uid()),
    'brooding_chick_sales', NEW.id, v_ref
  )
  ON CONFLICT (source_table, source_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, reason, metadata)
    VALUES ('insert_income', v_id, COALESCE(NEW.created_by, auth.uid()), 'system:trigger',
      'تم إنشاء حركة إيراد تلقائيًا من بيع كتاكيت',
      jsonb_build_object('source_table','brooding_chick_sales','source_id',NEW.id,'batch',v_batch));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lab_treasury_from_chick_sale ON public.brooding_chick_sales;
CREATE TRIGGER trg_lab_treasury_from_chick_sale
  AFTER INSERT ON public.brooding_chick_sales
  FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_from_chick_sale();

-- 7) Reports: hatching income by customer
CREATE OR REPLACE FUNCTION public.lab_treasury_hatching_by_customer(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(customer_name text, movements_count bigint, total_amount numeric, approved_amount numeric, pending_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(customer_name,'(بدون اسم)') AS customer_name,
    COUNT(*) AS movements_count,
    SUM(amount) AS total_amount,
    SUM(amount) FILTER (WHERE status='approved') AS approved_amount,
    SUM(amount) FILTER (WHERE status='pending') AS pending_amount
  FROM public.lab_treasury_movements
  WHERE income_category='hatching'
    AND (p_from IS NULL OR movement_date >= p_from)
    AND (p_to IS NULL OR movement_date <= p_to)
    AND status <> 'rejected'
  GROUP BY 1 ORDER BY total_amount DESC NULLS LAST;
$$;

-- 8) Reports: hatching income by batch (via source link → hatch_batches)
CREATE OR REPLACE FUNCTION public.lab_treasury_hatching_by_batch(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(batch_ref text, customer_name text, movements_count bigint, total_amount numeric, approved_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(m.source_ref,'(بدون مرجع)') AS batch_ref,
    COALESCE(m.customer_name,'(بدون اسم)') AS customer_name,
    COUNT(*) AS movements_count,
    SUM(m.amount) AS total_amount,
    SUM(m.amount) FILTER (WHERE m.status='approved') AS approved_amount
  FROM public.lab_treasury_movements m
  WHERE m.income_category='hatching'
    AND (p_from IS NULL OR m.movement_date >= p_from)
    AND (p_to IS NULL OR m.movement_date <= p_to)
    AND m.status <> 'rejected'
  GROUP BY 1,2 ORDER BY total_amount DESC NULLS LAST;
$$;

-- 9) Reports: chick sales by batch
CREATE OR REPLACE FUNCTION public.lab_treasury_chicksales_by_batch(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(batch_ref text, sales_count bigint, total_chicks numeric, total_amount numeric, approved_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(m.source_ref,'(بدون مرجع)') AS batch_ref,
    COUNT(*) AS sales_count,
    SUM(m.units_count) AS total_chicks,
    SUM(m.amount) AS total_amount,
    SUM(m.amount) FILTER (WHERE m.status='approved') AS approved_amount
  FROM public.lab_treasury_movements m
  WHERE m.income_category='chick_sales'
    AND (p_from IS NULL OR m.movement_date >= p_from)
    AND (p_to IS NULL OR m.movement_date <= p_to)
    AND m.status <> 'rejected'
  GROUP BY 1 ORDER BY total_amount DESC NULLS LAST;
$$;

-- 10) Reports: chick sales by customer
CREATE OR REPLACE FUNCTION public.lab_treasury_chicksales_by_customer(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE(customer_name text, sales_count bigint, total_chicks numeric, total_amount numeric, approved_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(m.customer_name,'(بدون اسم)') AS customer_name,
    COUNT(*) AS sales_count,
    SUM(m.units_count) AS total_chicks,
    SUM(m.amount) AS total_amount,
    SUM(m.amount) FILTER (WHERE m.status='approved') AS approved_amount
  FROM public.lab_treasury_movements m
  WHERE m.income_category='chick_sales'
    AND (p_from IS NULL OR m.movement_date >= p_from)
    AND (p_to IS NULL OR m.movement_date <= p_to)
    AND m.status <> 'rejected'
  GROUP BY 1 ORDER BY total_amount DESC NULLS LAST;
$$;

-- 11) Net operation report
CREATE OR REPLACE FUNCTION public.lab_treasury_net_operation(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'hatching_income', COALESCE(SUM(CASE WHEN income_category='hatching' AND status='approved' THEN amount END),0),
    'chick_sales_income', COALESCE(SUM(CASE WHEN income_category='chick_sales' AND status='approved' THEN amount END),0),
    'other_income', COALESCE(SUM(CASE WHEN income_category='other' AND status='approved' THEN amount END),0),
    'total_income', COALESCE(SUM(CASE WHEN movement_type='income' AND status='approved' THEN amount END),0),
    'total_expense', COALESCE(SUM(CASE WHEN movement_type='expense' AND status='approved' THEN amount END),0),
    'net_operation', COALESCE(SUM(CASE WHEN movement_type='income' AND status='approved' THEN amount
                                       WHEN movement_type='expense' AND status='approved' THEN -amount END),0),
    'pending_income', COALESCE(SUM(CASE WHEN movement_type='income' AND status='pending' THEN amount END),0),
    'pending_expense', COALESCE(SUM(CASE WHEN movement_type='expense' AND status='pending' THEN amount END),0)
  )
  FROM public.lab_treasury_movements
  WHERE (p_from IS NULL OR movement_date >= p_from)
    AND (p_to IS NULL OR movement_date <= p_to);
$$;

GRANT EXECUTE ON FUNCTION public.lab_treasury_hatching_by_customer(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_treasury_hatching_by_batch(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_treasury_chicksales_by_batch(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_treasury_chicksales_by_customer(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_treasury_net_operation(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lab_treasury_map_payment(text) TO authenticated;
