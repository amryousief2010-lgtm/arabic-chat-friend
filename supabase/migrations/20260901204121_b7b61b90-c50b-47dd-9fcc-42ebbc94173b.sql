CREATE OR REPLACE FUNCTION public.enforce_order_fulfillment_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only enforce for orders created inside the app by a real user
  IF NEW.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.fulfillment_type IS NULL OR btrim(NEW.fulfillment_type) = '' THEN
    RAISE EXCEPTION 'fulfillment_source_required'
      USING HINT = 'يجب تحديد مصدر تنفيذ الطلب (استلام/توصيل والمنفذ)';
  END IF;

  IF NEW.source_warehouse_id IS NULL
     AND (NEW.shipping_company IS NULL OR btrim(NEW.shipping_company) = '') THEN
    RAISE EXCEPTION 'fulfillment_source_required'
      USING HINT = 'يجب تحديد المنفذ (المخزن الرئيسي/العجوزة) أو شركة الشحن';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_order_fulfillment_source ON public.orders;
CREATE TRIGGER trg_enforce_order_fulfillment_source
BEFORE INSERT OR UPDATE OF fulfillment_type, source_warehouse_id, shipping_company
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enforce_order_fulfillment_source();