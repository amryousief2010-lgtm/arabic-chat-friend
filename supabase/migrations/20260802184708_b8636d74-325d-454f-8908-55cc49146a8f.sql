CREATE TABLE IF NOT EXISTS public.inventory_stock_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  warehouse_id uuid,
  item_name text,
  old_stock numeric,
  new_stock numeric,
  delta numeric,
  changed_by uuid DEFAULT auth.uid(),
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.inventory_stock_audit TO authenticated;
GRANT ALL ON public.inventory_stock_audit TO service_role;

ALTER TABLE public.inventory_stock_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stock_audit_read_authenticated"
ON public.inventory_stock_audit FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_isa_item_created ON public.inventory_stock_audit(item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_isa_created ON public.inventory_stock_audit(created_at DESC);

CREATE OR REPLACE FUNCTION public.log_inventory_stock_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src text;
BEGIN
  IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;

  -- هل توجد حركة مخزون في نفس المعاملة لنفس الصنف؟
  SELECT m.movement_type || COALESCE(' — ' || m.reason, '')
    INTO v_src
    FROM public.inventory_movements m
   WHERE m.item_id = NEW.id
     AND m.created_at > now() - interval '5 seconds'
   ORDER BY m.created_at DESC
   LIMIT 1;

  INSERT INTO public.inventory_stock_audit(
    item_id, warehouse_id, item_name, old_stock, new_stock, delta, source
  ) VALUES (
    NEW.id, NEW.warehouse_id, NEW.name, OLD.stock, NEW.stock,
    COALESCE(NEW.stock,0) - COALESCE(OLD.stock,0),
    COALESCE(v_src, 'تعديل مباشر بدون حركة مخزون')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_inventory_stock_change ON public.inventory_items;
CREATE TRIGGER trg_log_inventory_stock_change
AFTER UPDATE OF stock ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.log_inventory_stock_change();