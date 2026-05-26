
CREATE OR REPLACE FUNCTION public.notify_managers_on_shipment_damage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mgr RECORD;
  title_txt TEXT;
  desc_txt TEXT;
  fam TEXT;
BEGIN
  -- Only fire on transition into received/partial with damage
  IF COALESCE(NEW.damaged_count, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.damaged_count, 0) = COALESCE(NEW.damaged_count, 0)
     AND COALESCE(OLD.status, '') = COALESCE(NEW.status, '') THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('received', 'partial', 'rejected') THEN
    RETURN NEW;
  END IF;

  fam := COALESCE(NEW.family_number, '—');
  title_txt := '⚠️ هالك في استلام شحنة المعمل';
  desc_txt := 'الأسرة ' || fam
    || ' — تاريخ الإنتاج: ' || NEW.production_date::text
    || ' — مرسل: ' || NEW.egg_count::text
    || ' — مستلم: ' || COALESCE(NEW.received_egg_count, 0)::text
    || ' — هالك: ' || NEW.damaged_count::text;

  FOR mgr IN
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('general_manager'::app_role, 'executive_manager'::app_role)
  LOOP
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES (title_txt, desc_txt, 'farm_shipment_receipt', mgr.user_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_managers_on_shipment_damage ON public.farm_to_hatchery_shipments;
CREATE TRIGGER trg_notify_managers_on_shipment_damage
AFTER INSERT OR UPDATE ON public.farm_to_hatchery_shipments
FOR EACH ROW
EXECUTE FUNCTION public.notify_managers_on_shipment_damage();
