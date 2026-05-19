
-- 1) Audit log for imports/corrections/deletions
CREATE TABLE IF NOT EXISTS public.import_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL, -- 'import' | 'correction' | 'delete_bulk' | 'snapshot_upload' | 'auto_check'
  target_period text,   -- '2026-05'
  source_file text,
  performed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  rows_affected integer DEFAULT 0,
  details jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_import_audit_period ON public.import_audit_log(target_period, performed_at DESC);
ALTER TABLE public.import_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view audit log" ON public.import_audit_log
FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);
CREATE POLICY "Managers insert audit log" ON public.import_audit_log
FOR INSERT TO authenticated WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);

-- 2) Excel snapshots
CREATE TABLE IF NOT EXISTS public.excel_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,
  filename text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  total_rows integer DEFAULT 0,
  total_value numeric DEFAULT 0,
  delivered_count integer DEFAULT 0,
  delivered_value numeric DEFAULT 0,
  cancelled_count integer DEFAULT 0,
  pending_count integer DEFAULT 0,
  per_moderator jsonb DEFAULT '[]'::jsonb,
  per_day jsonb DEFAULT '[]'::jsonb,
  raw_rows jsonb DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_excel_snapshots_period ON public.excel_snapshots(period, uploaded_at DESC);
ALTER TABLE public.excel_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view snapshots" ON public.excel_snapshots
FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);
CREATE POLICY "Managers insert snapshots" ON public.excel_snapshots
FOR INSERT TO authenticated WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);
CREATE POLICY "Managers delete snapshots" ON public.excel_snapshots
FOR DELETE TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager']::app_role[])
);

-- 3) Discrepancy alerts
CREATE TABLE IF NOT EXISTS public.import_discrepancy_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period text NOT NULL,
  snapshot_id uuid REFERENCES public.excel_snapshots(id) ON DELETE CASCADE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  diff_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_discrepancy_alerts_open ON public.import_discrepancy_alerts(period, is_resolved, detected_at DESC);
ALTER TABLE public.import_discrepancy_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers view alerts" ON public.import_discrepancy_alerts
FOR SELECT TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);
CREATE POLICY "Managers insert alerts" ON public.import_discrepancy_alerts
FOR INSERT TO authenticated WITH CHECK (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);
CREATE POLICY "Managers update alerts" ON public.import_discrepancy_alerts
FOR UPDATE TO authenticated USING (
  public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[])
);

-- 4) Compare snapshot vs system aggregates and optionally raise alert + notification
CREATE OR REPLACE FUNCTION public.compare_period_to_snapshot(p_snapshot_id uuid, p_raise_alert boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.excel_snapshots%ROWTYPE;
  y int; m int;
  d_start timestamptz; d_end timestamptz;
  sys_total_rows int; sys_total_value numeric;
  sys_delivered_count int; sys_delivered_value numeric;
  sys_cancelled_count int; sys_pending_count int;
  diff jsonb;
  has_diff boolean;
  alert_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['general_manager','executive_manager','sales_manager','accountant','financial_manager','marketing_sales_manager']::app_role[]) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO s FROM public.excel_snapshots WHERE id = p_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Snapshot not found'; END IF;

  y := split_part(s.period,'-',1)::int;
  m := split_part(s.period,'-',2)::int;
  d_start := make_timestamptz(y, m, 1, 0, 0, 0, 'UTC');
  d_end := (d_start + INTERVAL '1 month');

  SELECT
    COUNT(*),
    COALESCE(SUM(subtotal),0),
    COUNT(*) FILTER (WHERE status = 'delivered'),
    COALESCE(SUM(subtotal) FILTER (WHERE status = 'delivered'),0),
    COUNT(*) FILTER (WHERE status = 'cancelled'),
    COUNT(*) FILTER (WHERE status = 'pending')
  INTO sys_total_rows, sys_total_value, sys_delivered_count, sys_delivered_value, sys_cancelled_count, sys_pending_count
  FROM public.orders
  WHERE created_at >= d_start AND created_at < d_end;

  diff := jsonb_build_object(
    'period', s.period,
    'snapshot_id', s.id,
    'snapshot', jsonb_build_object(
      'total_rows', s.total_rows,
      'total_value', s.total_value,
      'delivered_count', s.delivered_count,
      'delivered_value', s.delivered_value,
      'cancelled_count', s.cancelled_count,
      'pending_count', s.pending_count
    ),
    'system', jsonb_build_object(
      'total_rows', sys_total_rows,
      'total_value', sys_total_value,
      'delivered_count', sys_delivered_count,
      'delivered_value', sys_delivered_value,
      'cancelled_count', sys_cancelled_count,
      'pending_count', sys_pending_count
    ),
    'differences', jsonb_build_object(
      'total_rows', sys_total_rows - s.total_rows,
      'total_value', sys_total_value - s.total_value,
      'delivered_count', sys_delivered_count - s.delivered_count,
      'delivered_value', sys_delivered_value - s.delivered_value,
      'cancelled_count', sys_cancelled_count - s.cancelled_count,
      'pending_count', sys_pending_count - s.pending_count
    )
  );

  has_diff := (sys_total_rows <> s.total_rows)
           OR (ROUND(sys_total_value,2) <> ROUND(s.total_value,2))
           OR (sys_delivered_count <> s.delivered_count)
           OR (sys_cancelled_count <> s.cancelled_count)
           OR (sys_pending_count <> s.pending_count);

  IF p_raise_alert AND has_diff THEN
    INSERT INTO public.import_discrepancy_alerts (period, snapshot_id, diff_summary)
    VALUES (s.period, s.id, diff)
    RETURNING id INTO alert_id;

    INSERT INTO public.notifications (title, description, type)
    VALUES (
      '⚠️ تباين بين النظام وملف Excel — ' || s.period,
      'فارق الطلبات: ' || (sys_total_rows - s.total_rows)::text ||
      ' • فارق القيمة: ' || ROUND(sys_total_value - s.total_value)::text || ' ج.م',
      'import_discrepancy'
    );
  END IF;

  RETURN diff || jsonb_build_object('has_diff', has_diff, 'alert_id', alert_id);
END;
$$;

-- 5) Auto-check trigger: when a snapshot row is inserted, run comparison automatically
CREATE OR REPLACE FUNCTION public.auto_compare_after_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.compare_period_to_snapshot(NEW.id, true);
  INSERT INTO public.import_audit_log (action, target_period, source_file, performed_by, rows_affected, details)
  VALUES ('snapshot_upload', NEW.period, NEW.filename, NEW.uploaded_by, NEW.total_rows,
          jsonb_build_object('total_value', NEW.total_value, 'delivered_count', NEW.delivered_count));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_auto_compare_after_snapshot ON public.excel_snapshots;
CREATE TRIGGER trg_auto_compare_after_snapshot
AFTER INSERT ON public.excel_snapshots
FOR EACH ROW EXECUTE FUNCTION public.auto_compare_after_snapshot();
