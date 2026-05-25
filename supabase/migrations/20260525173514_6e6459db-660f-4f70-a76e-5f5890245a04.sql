-- Phase 4A: Disable duplicate AFTER INSERT trigger on order_items (idempotent, reversible)

CREATE TABLE IF NOT EXISTS public.trigger_patch_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patched_at timestamptz NOT NULL DEFAULT now(),
  phase text NOT NULL,
  action text NOT NULL,
  trigger_name text,
  table_name text,
  previous_definition text,
  notes text
);

ALTER TABLE public.trigger_patch_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='trigger_patch_audit'
      AND policyname='audit readable by managers'
  ) THEN
    CREATE POLICY "audit readable by managers" ON public.trigger_patch_audit
      FOR SELECT TO authenticated
      USING (
        public.has_role(auth.uid(),'general_manager'::app_role)
        OR public.has_role(auth.uid(),'executive_manager'::app_role)
        OR public.has_role(auth.uid(),'warehouse_supervisor'::app_role)
      );
  END IF;
END$$;

DO $$
DECLARE
  v_enabled char;
  v_def text;
BEGIN
  SELECT t.tgenabled, pg_get_triggerdef(t.oid)
    INTO v_enabled, v_def
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname='order_items'
    AND t.tgname='trg_order_item_insert'
    AND NOT t.tgisinternal;

  IF v_enabled IS NULL THEN
    INSERT INTO public.trigger_patch_audit(phase,action,trigger_name,table_name,notes)
    VALUES ('PHASE_4A','SKIP_NOT_FOUND','trg_order_item_insert','order_items',
            'Trigger not found; nothing to disable.');
  ELSIF v_enabled = 'D' THEN
    INSERT INTO public.trigger_patch_audit(phase,action,trigger_name,table_name,previous_definition,notes)
    VALUES ('PHASE_4A','ALREADY_DISABLED','trg_order_item_insert','order_items',v_def,
            'Trigger was already disabled before this patch ran. No change.');
  ELSE
    INSERT INTO public.trigger_patch_audit(phase,action,trigger_name,table_name,previous_definition,notes)
    VALUES ('PHASE_4A','DISABLE','trg_order_item_insert','order_items',v_def,
            'Duplicate of trg_deduct_stock_on_order_item. Disabled (not dropped) to stop double-deduction. Reversal: ALTER TABLE public.order_items ENABLE TRIGGER trg_order_item_insert;');
    EXECUTE 'ALTER TABLE public.order_items DISABLE TRIGGER trg_order_item_insert';
  END IF;
END$$;