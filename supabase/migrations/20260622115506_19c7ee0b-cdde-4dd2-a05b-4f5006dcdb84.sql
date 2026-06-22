
-- 1) Extend allowed kinds to include manufacturing_labor
ALTER TABLE public.feed_factory_treasury_txns DROP CONSTRAINT IF EXISTS feed_factory_treasury_txns_kind_check;
ALTER TABLE public.feed_factory_treasury_txns ADD CONSTRAINT feed_factory_treasury_txns_kind_check
  CHECK (kind = ANY (ARRAY['sale','purchase','loan_from_naam','loan_to_naam','manual_in','manual_out',
    'opening_balance','other','custody_shoala','custody_gamal','general_expense','tobacco_expense',
    'transport_expense','feed_sales_return_refund','feed_sales_return_cancel','internal_collection',
    'internal_collection_reversal','internal_feed_payment','internal_feed_payment_reversal',
    'manufacturing_labor']));

-- 2) Unique guard: one labor txn per feed_production_invoice
CREATE UNIQUE INDEX IF NOT EXISTS uniq_feed_invoice_labor_txn
  ON public.feed_factory_treasury_txns(ref_id)
  WHERE ref_table = 'feed_production_invoice' AND kind = 'manufacturing_labor';

-- 3) Trigger: sync labor_cost on feed_production_invoices -> treasury txn
CREATE OR REPLACE FUNCTION public.feed_invoice_labor_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount numeric;
  v_prod_no text;
  v_date date;
  v_existing uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.feed_factory_treasury_txns
     WHERE ref_table = 'feed_production_invoice'
       AND ref_id = OLD.id
       AND kind = 'manufacturing_labor';
    RETURN OLD;
  END IF;

  v_amount := COALESCE(NEW.labor_cost, 0);
  v_prod_no := NEW.prod_no;
  v_date := COALESCE(NEW.prod_date, CURRENT_DATE);

  SELECT id INTO v_existing
    FROM public.feed_factory_treasury_txns
   WHERE ref_table = 'feed_production_invoice'
     AND ref_id = NEW.id
     AND kind = 'manufacturing_labor'
   LIMIT 1;

  IF v_amount <= 0 THEN
    IF v_existing IS NOT NULL THEN
      DELETE FROM public.feed_factory_treasury_txns WHERE id = v_existing;
    END IF;
    RETURN NEW;
  END IF;

  IF v_existing IS NULL THEN
    INSERT INTO public.feed_factory_treasury_txns(
      txn_no, txn_date, direction, kind, amount,
      ref_table, ref_id, party, note, created_by
    ) VALUES (
      'TRZ-LAB-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(replace(gen_random_uuid()::text,'-',''),1,6),
      v_date, 'out', 'manufacturing_labor', v_amount,
      'feed_production_invoice', NEW.id, 'مصنع الأعلاف',
      'أجرة تصنيع لفاتورة رقم ' || COALESCE(v_prod_no,''),
      NEW.created_by
    );
  ELSE
    UPDATE public.feed_factory_treasury_txns
       SET amount = v_amount,
           txn_date = v_date,
           note = 'أجرة تصنيع لفاتورة رقم ' || COALESCE(v_prod_no,'')
     WHERE id = v_existing;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_invoice_labor_sync_ins ON public.feed_production_invoices;
CREATE TRIGGER trg_feed_invoice_labor_sync_ins
  AFTER INSERT ON public.feed_production_invoices
  FOR EACH ROW EXECUTE FUNCTION public.feed_invoice_labor_sync();

DROP TRIGGER IF EXISTS trg_feed_invoice_labor_sync_upd ON public.feed_production_invoices;
CREATE TRIGGER trg_feed_invoice_labor_sync_upd
  AFTER UPDATE OF labor_cost, prod_no, prod_date ON public.feed_production_invoices
  FOR EACH ROW EXECUTE FUNCTION public.feed_invoice_labor_sync();

DROP TRIGGER IF EXISTS trg_feed_invoice_labor_sync_del ON public.feed_production_invoices;
CREATE TRIGGER trg_feed_invoice_labor_sync_del
  AFTER DELETE ON public.feed_production_invoices
  FOR EACH ROW EXECUTE FUNCTION public.feed_invoice_labor_sync();

-- 4) Backfill: any existing invoice with labor_cost > 0 and no linked txn
INSERT INTO public.feed_factory_treasury_txns(
  txn_no, txn_date, direction, kind, amount,
  ref_table, ref_id, party, note, created_by
)
SELECT
  'TRZ-LAB-BF-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(replace(i.id::text,'-',''),1,6),
  i.prod_date, 'out', 'manufacturing_labor', i.labor_cost,
  'feed_production_invoice', i.id, 'مصنع الأعلاف',
  'أجرة تصنيع لفاتورة رقم ' || COALESCE(i.prod_no,'') || ' (تصحيح تلقائي)',
  i.created_by
FROM public.feed_production_invoices i
WHERE COALESCE(i.labor_cost, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.feed_factory_treasury_txns t
    WHERE t.ref_table = 'feed_production_invoice'
      AND t.ref_id = i.id
      AND t.kind = 'manufacturing_labor'
  );
