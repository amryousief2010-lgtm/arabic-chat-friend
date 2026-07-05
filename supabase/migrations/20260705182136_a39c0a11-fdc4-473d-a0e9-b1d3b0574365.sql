
-- Backfill shipping_bill_no on orders from matched zodex closed invoice orders
UPDATE public.orders o
SET shipping_bill_no = z.bill_no
FROM public.zodex_closed_invoice_orders z
WHERE z.order_id = o.id
  AND z.bill_no IS NOT NULL
  AND (o.shipping_bill_no IS NULL OR o.shipping_bill_no = '');

-- Trigger: when a zodex_closed_invoice_orders row is inserted/updated with an order_id,
-- push its bill_no onto the linked order if the order doesn't already have one.
CREATE OR REPLACE FUNCTION public.sync_zodex_bill_no_to_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL AND NEW.bill_no IS NOT NULL AND NEW.bill_no <> '' THEN
    UPDATE public.orders
      SET shipping_bill_no = NEW.bill_no
    WHERE id = NEW.order_id
      AND (shipping_bill_no IS NULL OR shipping_bill_no = '' OR shipping_bill_no <> NEW.bill_no);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_zodex_bill_no_to_order ON public.zodex_closed_invoice_orders;
CREATE TRIGGER trg_sync_zodex_bill_no_to_order
AFTER INSERT OR UPDATE OF order_id, bill_no ON public.zodex_closed_invoice_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_zodex_bill_no_to_order();
