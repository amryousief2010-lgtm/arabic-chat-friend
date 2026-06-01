
-- معرّف المخزن الرئيسي ثابت في الكود؛ نستخدم اللي بيتطابق بالاسم لمرونة أكبر
CREATE OR REPLACE FUNCTION public.notify_main_warehouse_incoming()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_main_id uuid;
  v_item_name text;
  v_recipient uuid;
BEGIN
  SELECT id INTO v_main_id FROM public.warehouses
  WHERE name ILIKE '%الرئيسي%' OR name ILIKE '%المقر%' LIMIT 1;

  IF NEW.warehouse_id IS DISTINCT FROM v_main_id THEN
    RETURN NEW;
  END IF;
  IF NEW.movement_type <> 'in' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_item_name FROM public.inventory_items WHERE id = NEW.item_id;

  -- استهدف هادي + المدراء (general/executive)
  FOR v_recipient IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('general_manager','executive_manager')
    UNION
    SELECT id FROM public.profiles WHERE email = 'abdelhady.ali@coceg.net'
  LOOP
    INSERT INTO public.notifications(title, description, type, target_user_id)
    VALUES (
      '📥 توريد للمخزن الرئيسي',
      'تم تسجيل وارد ' || COALESCE(v_item_name,'صنف') || ' كمية ' || NEW.quantity ||
      COALESCE(' — ' || NEW.notes, ''),
      'main_warehouse_in',
      v_recipient
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_main_warehouse_incoming ON public.inventory_movements;
CREATE TRIGGER trg_notify_main_warehouse_incoming
AFTER INSERT ON public.inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.notify_main_warehouse_incoming();


-- إشعار عند تسليم أوردر مصدره المخزن الرئيسي
CREATE OR REPLACE FUNCTION public.notify_main_warehouse_order_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_main_id uuid;
  v_recipient uuid;
BEGIN
  SELECT id INTO v_main_id FROM public.warehouses
  WHERE name ILIKE '%الرئيسي%' OR name ILIKE '%المقر%' LIMIT 1;

  IF NEW.status <> 'delivered' OR OLD.status = 'delivered' THEN
    RETURN NEW;
  END IF;
  IF NEW.source_warehouse_id IS DISTINCT FROM v_main_id THEN
    RETURN NEW;
  END IF;

  FOR v_recipient IN
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role IN ('general_manager','executive_manager')
    UNION
    SELECT id FROM public.profiles WHERE email = 'abdelhady.ali@coceg.net'
  LOOP
    INSERT INTO public.notifications(title, description, type, order_id, target_user_id)
    VALUES (
      '✅ استلام أوردر من المخزن الرئيسي',
      'تم تأكيد استلام الأوردر ' || COALESCE(NEW.order_number,'') || ' الصادر من المخزن الرئيسي',
      'main_warehouse_delivered',
      NEW.id,
      v_recipient
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_main_warehouse_order_delivered ON public.orders;
CREATE TRIGGER trg_notify_main_warehouse_order_delivered
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.notify_main_warehouse_order_delivered();
