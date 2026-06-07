-- 1) Remove the approval block: girls can now create duplicate orders without marketing-manager approval.
DROP TRIGGER IF EXISTS trg_enforce_duplicate_order_approval ON public.orders;

-- 2) New trigger: when a sales_moderator creates an order for a customer
--    whose phone already had another order in the same calendar month,
--    raise a notification for the sales manager(s).
CREATE OR REPLACE FUNCTION public.notify_duplicate_customer_order_monthly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_phone text;
  v_name  text;
  v_prev_count int;
  v_month_start timestamptz;
  v_month_end   timestamptz;
BEGIN
  IF NEW.created_by IS NULL OR NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only trigger for sales moderators (girls)
  IF NOT public.has_role(NEW.created_by, 'sales_moderator'::app_role) THEN
    RETURN NEW;
  END IF;

  SELECT phone, name INTO v_phone, v_name
  FROM public.customers
  WHERE id = NEW.customer_id;

  IF v_phone IS NULL OR length(btrim(v_phone)) = 0 THEN
    RETURN NEW;
  END IF;

  -- Calendar month of the new order (Cairo timezone aware via date_trunc on local time)
  v_month_start := date_trunc('month', (NEW.created_at AT TIME ZONE 'Africa/Cairo')) AT TIME ZONE 'Africa/Cairo';
  v_month_end   := (v_month_start + INTERVAL '1 month');

  SELECT COUNT(*) INTO v_prev_count
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE c.phone = v_phone
    AND o.id <> NEW.id
    AND o.created_at >= v_month_start
    AND o.created_at <  v_month_end;

  IF v_prev_count > 0 THEN
    INSERT INTO public.notifications (title, description, type, order_id)
    VALUES (
      '⚠️ طلب مكرر لنفس العميل خلال الشهر',
      'تم تسجيل طلب جديد رقم ' || NEW.order_number ||
      ' للعميل ' || COALESCE(v_name, '') ||
      ' (هاتف: ' || v_phone || ')' ||
      ' وله ' || v_prev_count::text || ' طلب/طلبات سابقة خلال نفس الشهر.',
      'duplicate_customer_month',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_duplicate_customer_order_monthly ON public.orders;
CREATE TRIGGER trg_notify_duplicate_customer_order_monthly
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_duplicate_customer_order_monthly();