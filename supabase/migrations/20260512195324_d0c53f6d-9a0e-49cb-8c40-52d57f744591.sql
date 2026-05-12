
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.set_order_delivered_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') AND NEW.delivered_at IS NULL THEN
    NEW.delivered_at := now();
  ELSIF NEW.status <> 'delivered' AND OLD.status = 'delivered' THEN
    NEW.delivered_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_order_delivered_at ON public.orders;
CREATE TRIGGER trg_set_order_delivered_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.set_order_delivered_at();

UPDATE public.orders SET delivered_at = updated_at WHERE status = 'delivered' AND delivered_at IS NULL;
