
-- Trigger: notify warehouse supervisors when slaughter outputs are dispatched to main warehouse
CREATE OR REPLACE FUNCTION public.notify_main_warehouse_slaughter_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_number text;
  v_slaughter_date date;
  v_already_exists boolean;
BEGIN
  IF NEW.destination NOT IN ('warehouse','branch') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.received_status,'pending') = 'received' THEN
    RETURN NEW;
  END IF;

  -- Dedupe: one notification per batch within the last 10 minutes
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE type = 'main_warehouse_inbound_slaughter'
      AND description LIKE '%' || NEW.batch_id::text || '%'
      AND created_at > now() - interval '10 minutes'
  ) INTO v_already_exists;
  IF v_already_exists THEN RETURN NEW; END IF;

  SELECT batch_number, slaughter_date
    INTO v_batch_number, v_slaughter_date
  FROM public.slaughter_batches WHERE id = NEW.batch_id;

  INSERT INTO public.notifications (title, description, type)
  VALUES (
    '📦 وارد جديد من المجزر للمخزن الرئيسي',
    'تم تحويل مخزون جديد إلى المخزن الرئيسي بانتظار الاستلام — الدفعة ' || COALESCE(v_batch_number,'') ||
    ' • تاريخ التحويل: ' || to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') ||
    ' [batch:' || NEW.batch_id::text || ']',
    'main_warehouse_inbound_slaughter'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_main_wh_slaughter_inbound ON public.slaughter_batch_outputs;
CREATE TRIGGER trg_notify_main_wh_slaughter_inbound
AFTER INSERT ON public.slaughter_batch_outputs
FOR EACH ROW EXECUTE FUNCTION public.notify_main_warehouse_slaughter_inbound();


-- Trigger: notify when meat factory transfers stock to a warehouse
CREATE OR REPLACE FUNCTION public.notify_main_warehouse_meat_inbound()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wh_name text;
  v_wh_type text;
  v_already_exists boolean;
BEGIN
  SELECT name, type INTO v_wh_name, v_wh_type
  FROM public.warehouses WHERE id = NEW.destination_warehouse_id;

  -- Only notify for main / finished-goods warehouse transfers
  IF COALESCE(v_wh_type,'') NOT IN ('finished_goods','general')
     AND COALESCE(v_wh_name,'') NOT LIKE '%الرئيسي%'
     AND COALESCE(v_wh_name,'') NOT LIKE '%المقر%' THEN
    RETURN NEW;
  END IF;

  -- Dedupe per transfer batch (invoice_id or transfer_no) within 10 minutes
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE type = 'main_warehouse_inbound_meat'
      AND description LIKE '%' || COALESCE(NEW.invoice_id::text, NEW.transfer_no) || '%'
      AND created_at > now() - interval '10 minutes'
  ) INTO v_already_exists;
  IF v_already_exists THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (title, description, type)
  VALUES (
    '📦 وارد جديد من مصنع اللحوم للمخزن الرئيسي',
    'تم تحويل مخزون جديد إلى المخزن الرئيسي بانتظار الاستلام — رقم العملية: ' || NEW.transfer_no ||
    ' • المخزن: ' || COALESCE(v_wh_name,'—') ||
    ' • تاريخ التحويل: ' || to_char(now() AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD HH24:MI') ||
    ' [ref:' || COALESCE(NEW.invoice_id::text, NEW.transfer_no) || ']',
    'main_warehouse_inbound_meat'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_main_wh_meat_inbound ON public.meat_production_transfers;
CREATE TRIGGER trg_notify_main_wh_meat_inbound
AFTER INSERT ON public.meat_production_transfers
FOR EACH ROW EXECUTE FUNCTION public.notify_main_warehouse_meat_inbound();
