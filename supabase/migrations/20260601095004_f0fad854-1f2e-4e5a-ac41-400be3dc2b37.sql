
ALTER TABLE public.feed_production_invoices
  ADD COLUMN IF NOT EXISTS labor_cost numeric NOT NULL DEFAULT 0;

ALTER TABLE public.feed_sales
  ADD COLUMN IF NOT EXISTS customer_phone text,
  ADD COLUMN IF NOT EXISTS salesperson text;

CREATE OR REPLACE FUNCTION public.finalize_feed_production(_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total numeric;
  v_items_total numeric;
  v_labor numeric;
  v_qty numeric;
  v_prod uuid;
  v_old_stock numeric;
  v_old_cost numeric;
  v_new_cost numeric;
BEGIN
  SELECT COALESCE(SUM(line_cost),0) INTO v_items_total
    FROM feed_production_invoice_items WHERE invoice_id = _invoice_id;

  SELECT qty_produced, product_id, COALESCE(labor_cost,0)
    INTO v_qty, v_prod, v_labor
    FROM feed_production_invoices WHERE id = _invoice_id;

  v_total := v_items_total + COALESCE(v_labor,0);

  SELECT COALESCE(current_stock,0), COALESCE(latest_unit_cost,0)
    INTO v_old_stock, v_old_cost
    FROM feed_products WHERE id = v_prod;

  IF (v_old_stock + v_qty) > 0 THEN
    v_new_cost := ((v_old_stock*v_old_cost) + v_total) / (v_old_stock + v_qty);
  ELSE
    v_new_cost := CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END;
  END IF;

  UPDATE feed_products
     SET current_stock = v_old_stock + v_qty,
         latest_unit_cost = v_new_cost,
         updated_at = now()
   WHERE id = v_prod;

  UPDATE feed_production_invoices
     SET total_cost = v_total,
         unit_cost = CASE WHEN v_qty>0 THEN v_total/v_qty ELSE 0 END,
         updated_at = now()
   WHERE id = _invoice_id;
END $function$;

INSERT INTO public.feed_raw_materials (name, unit, is_active)
SELECT 'مضاد سموم', 'كجم', true
WHERE NOT EXISTS (SELECT 1 FROM public.feed_raw_materials WHERE name = 'مضاد سموم');
