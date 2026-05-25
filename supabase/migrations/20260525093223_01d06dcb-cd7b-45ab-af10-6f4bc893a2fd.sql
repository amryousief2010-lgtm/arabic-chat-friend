
-- 1. Unified meat factory audit log
CREATE TABLE IF NOT EXISTS public.meat_factory_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  performed_by uuid,
  performed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_meat_audit_table_time ON public.meat_factory_audit_log (table_name, performed_at DESC);

ALTER TABLE public.meat_factory_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meat_audit_select" ON public.meat_factory_audit_log;
CREATE POLICY "meat_audit_select" ON public.meat_factory_audit_log
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'meat_factory_manager'::app_role,'quality_manager'::app_role,
    'accountant'::app_role,'financial_manager'::app_role
  ]));

-- Generic logger for meat factory tables
CREATE OR REPLACE FUNCTION public.meat_factory_log_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_id := (to_jsonb(OLD)->>'id')::uuid;
    INSERT INTO public.meat_factory_audit_log(table_name,row_id,action,old_value,performed_by)
    VALUES (TG_TABLE_NAME, v_id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'INSERT' THEN
    v_id := (to_jsonb(NEW)->>'id')::uuid;
    INSERT INTO public.meat_factory_audit_log(table_name,row_id,action,new_value,performed_by)
    VALUES (TG_TABLE_NAME, v_id, 'insert', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) <> to_jsonb(NEW) THEN
      v_id := (to_jsonb(NEW)->>'id')::uuid;
      INSERT INTO public.meat_factory_audit_log(table_name,row_id,action,old_value,new_value,performed_by)
      VALUES (TG_TABLE_NAME, v_id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

-- Attach to meat factory critical tables
DROP TRIGGER IF EXISTS trg_meat_audit_recipes ON public.meat_factory_recipes;
CREATE TRIGGER trg_meat_audit_recipes
  AFTER INSERT OR UPDATE OR DELETE ON public.meat_factory_recipes
  FOR EACH ROW EXECUTE FUNCTION public.meat_factory_log_changes();

DROP TRIGGER IF EXISTS trg_meat_audit_batches ON public.meat_factory_batches;
CREATE TRIGGER trg_meat_audit_batches
  AFTER INSERT OR UPDATE OR DELETE ON public.meat_factory_batches
  FOR EACH ROW EXECUTE FUNCTION public.meat_factory_log_changes();

DROP TRIGGER IF EXISTS trg_meat_audit_raw_materials ON public.meat_factory_raw_materials;
CREATE TRIGGER trg_meat_audit_raw_materials
  AFTER INSERT OR UPDATE OR DELETE ON public.meat_factory_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.meat_factory_log_changes();

DROP TRIGGER IF EXISTS trg_meat_audit_batch_consumption ON public.meat_factory_batch_consumption;
CREATE TRIGGER trg_meat_audit_batch_consumption
  AFTER INSERT OR UPDATE OR DELETE ON public.meat_factory_batch_consumption
  FOR EACH ROW EXECUTE FUNCTION public.meat_factory_log_changes();

DROP TRIGGER IF EXISTS trg_meat_audit_batch_packaging ON public.meat_factory_batch_packaging;
CREATE TRIGGER trg_meat_audit_batch_packaging
  AFTER INSERT OR UPDATE OR DELETE ON public.meat_factory_batch_packaging
  FOR EACH ROW EXECUTE FUNCTION public.meat_factory_log_changes();

-- 2. Extend feed audit to recipes / recipe items / raw materials
DROP TRIGGER IF EXISTS trg_feed_audit_recipes ON public.feed_recipes;
CREATE TRIGGER trg_feed_audit_recipes
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_recipes
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();

DROP TRIGGER IF EXISTS trg_feed_audit_recipe_items ON public.feed_recipe_items;
CREATE TRIGGER trg_feed_audit_recipe_items
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_recipe_items
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();

DROP TRIGGER IF EXISTS trg_feed_audit_raw_materials ON public.feed_raw_materials;
CREATE TRIGGER trg_feed_audit_raw_materials
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_raw_materials
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();

DROP TRIGGER IF EXISTS trg_feed_audit_production_batches ON public.feed_production_batches;
CREATE TRIGGER trg_feed_audit_production_batches
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_production_batches
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();

DROP TRIGGER IF EXISTS trg_feed_audit_finished_moves ON public.feed_finished_goods_moves;
CREATE TRIGGER trg_feed_audit_finished_moves
  AFTER INSERT OR UPDATE OR DELETE ON public.feed_finished_goods_moves
  FOR EACH ROW EXECUTE FUNCTION public.feed_log_changes();
