
-- Add column to capture order total at the moment of delivery
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_at_delivery numeric;

-- Update trigger function to also snapshot total when status becomes delivered
CREATE OR REPLACE FUNCTION public.set_order_delivered_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') THEN
    IF NEW.delivered_at IS NULL THEN
      NEW.delivered_at := now();
    END IF;
    -- snapshot the total at the moment of delivery
    NEW.total_at_delivery := NEW.total;
  ELSIF NEW.status <> 'delivered' AND OLD.status = 'delivered' THEN
    NEW.delivered_at := NULL;
    NEW.total_at_delivery := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- Backfill existing delivered orders that don't have a snapshot yet
UPDATE public.orders SET total_at_delivery = total
WHERE status = 'delivered' AND total_at_delivery IS NULL;
