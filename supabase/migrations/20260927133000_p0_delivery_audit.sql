-- P0 / 4 — Audit delivery status and the real delivered_at.
-- Who changed the status and when is stored on order_status_audit.
-- The existing payment/collection logging stays.

CREATE OR REPLACE FUNCTION public.log_order_status_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM public.profiles WHERE id = auth.uid();

  IF COALESCE(OLD.payment_status,'') <> COALESCE(NEW.payment_status,'') THEN
    INSERT INTO public.order_status_audit (order_id, order_number, field_name, old_value, new_value, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.order_number, 'payment_status', OLD.payment_status, NEW.payment_status, auth.uid(), v_name);
  END IF;

  IF COALESCE(OLD.collection_status,'') <> COALESCE(NEW.collection_status,'') THEN
    INSERT INTO public.order_status_audit (order_id, order_number, field_name, old_value, new_value, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.order_number, 'collection_status', OLD.collection_status, NEW.collection_status, auth.uid(), v_name);
  END IF;

  IF COALESCE(OLD.status,'') <> COALESCE(NEW.status,'') THEN
    INSERT INTO public.order_status_audit (order_id, order_number, field_name, old_value, new_value, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.order_number, 'status', OLD.status, NEW.status, auth.uid(), v_name);
  END IF;

  IF COALESCE(OLD.delivered_at::text,'') <> COALESCE(NEW.delivered_at::text,'') THEN
    INSERT INTO public.order_status_audit (order_id, order_number, field_name, old_value, new_value, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.order_number, 'delivered_at', OLD.delivered_at::text, NEW.delivered_at::text, auth.uid(), v_name);
  END IF;

  RETURN NEW;
END;
$$;
