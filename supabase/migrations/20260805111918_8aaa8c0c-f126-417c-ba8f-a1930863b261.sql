CREATE OR REPLACE FUNCTION public.redirect_merged_item_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_canonical uuid;
  v_delta numeric;
BEGIN
  SELECT canonical_item_id INTO v_canonical
  FROM public.inventory_item_merge_log
  WHERE source_item_id = NEW.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_canonical IS NULL OR v_canonical = NEW.id THEN
    RETURN NEW;
  END IF;

  -- الكارت المدمج المعطّل يجب أن يظل صفراً. أي إضافة جديدة فقط
  -- تُحوّل للكارت الأساسي، أما تصفير الرصيد القديم فلا يخصم من الأساسي.
  IF OLD.is_active = false THEN
    v_delta := GREATEST(COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0), 0);
  ELSE
    v_delta := COALESCE(NEW.stock, 0) - COALESCE(OLD.stock, 0);
  END IF;

  IF v_delta <> 0 THEN
    UPDATE public.inventory_items
    SET stock = COALESCE(stock, 0) + v_delta,
        is_active = true,
        updated_at = now()
    WHERE id = v_canonical;
  END IF;

  NEW.stock := 0;
  NEW.is_active := false;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_inventory_transfer_destination(uuid, uuid) TO service_role;