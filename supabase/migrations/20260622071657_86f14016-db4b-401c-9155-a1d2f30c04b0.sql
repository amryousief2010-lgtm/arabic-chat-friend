-- 1) Cancel/archive the orphan duplicate invoice (no items, no expenses, no movements, no treasury txns)
--    We delete it because there is NO linked audit/inventory/treasury record to preserve.
DELETE FROM public.feed_production_invoices
WHERE id = '73629f3b-c0b7-4ce8-adcd-1b2624106a05'
  AND prod_no = 'PROD-260601121607684'
  AND NOT EXISTS (SELECT 1 FROM public.feed_production_invoice_items WHERE invoice_id = '73629f3b-c0b7-4ce8-adcd-1b2624106a05')
  AND NOT EXISTS (SELECT 1 FROM public.feed_production_invoice_expenses WHERE invoice_id = '73629f3b-c0b7-4ce8-adcd-1b2624106a05');

-- 2) Add an idempotency column (client_request_id) to feed_production_invoices
ALTER TABLE public.feed_production_invoices
  ADD COLUMN IF NOT EXISTS client_request_id text;

-- Unique only when set (so legacy rows with NULL stay valid)
CREATE UNIQUE INDEX IF NOT EXISTS feed_prod_invoices_client_req_uidx
  ON public.feed_production_invoices(client_request_id)
  WHERE client_request_id IS NOT NULL;

-- 3) Soft duplicate guard: same (product, date, qty, bags, user) within 2 minutes
--    Implemented via trigger because CHECK can't reference now()/other rows.
CREATE OR REPLACE FUNCTION public.guard_feed_production_dup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.feed_production_invoices
  WHERE product_id = NEW.product_id
    AND prod_date  = NEW.prod_date
    AND qty_produced = NEW.qty_produced
    AND bags = NEW.bags
    AND coalesce(created_by::text,'') = coalesce(NEW.created_by::text,'')
    AND created_at >= (now() - interval '2 minutes')
    AND id <> NEW.id;
  IF v_count > 0 THEN
    RAISE EXCEPTION 'تم تسجيل هذه عملية التصنيع بالفعل، لا يمكن تكرارها.'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_feed_production_dup ON public.feed_production_invoices;
CREATE TRIGGER trg_guard_feed_production_dup
  BEFORE INSERT ON public.feed_production_invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_feed_production_dup();