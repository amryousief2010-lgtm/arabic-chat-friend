
ALTER TABLE public.slaughter_batches
  ADD COLUMN IF NOT EXISTS butcher_1_id uuid REFERENCES public.slaughter_workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS butcher_2_id uuid REFERENCES public.slaughter_workers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS butcher_3_id uuid REFERENCES public.slaughter_workers(id) ON DELETE SET NULL;

ALTER TABLE public.slaughter_workers
  ADD COLUMN IF NOT EXISTS lead_rank smallint;

INSERT INTO public.slaughter_workers (full_name, role, daily_wage, is_active, hire_date, lead_rank, notes)
SELECT v.full_name, 'supervisor', 0, true, CURRENT_DATE, v.lead_rank, v.notes
FROM (VALUES
  ('محمود جمال', 1::smallint, 'جزار مسؤول أول المجزر'),
  ('حمدي حماد', 2::smallint, 'جزار مسؤول ثاني المجزر'),
  ('إبراهيم السعدني', 3::smallint, 'جزار مسؤول ثالث المجزر')
) v(full_name, lead_rank, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.slaughter_workers w WHERE w.full_name = v.full_name);

-- Backfill lead_rank for existing rows that match by name (if seeded previously without rank)
UPDATE public.slaughter_workers SET lead_rank = 1 WHERE full_name = 'محمود جمال' AND lead_rank IS NULL;
UPDATE public.slaughter_workers SET lead_rank = 2 WHERE full_name = 'حمدي حماد' AND lead_rank IS NULL;
UPDATE public.slaughter_workers SET lead_rank = 3 WHERE full_name = 'إبراهيم السعدني' AND lead_rank IS NULL;

CREATE OR REPLACE VIEW public.v_slaughter_transfer_shipments AS
SELECT
  ('SHP-' || to_char(t.transferred_at, 'YYYYMMDDHH24MISS') || '-' || substr(t.batch_id::text,1,4) || '-' || substr(t.branch_id::text,1,4)) AS shipment_no,
  t.batch_id,
  b.batch_number,
  b.slaughter_date,
  t.branch_id,
  t.transferred_at,
  MIN(t.transferred_at) AS created_at,
  MAX(t.received_at_safe) AS received_at,
  SUM(t.weight_kg)::numeric AS total_kg,
  SUM(t.total_value)::numeric AS total_value,
  COUNT(*)::int AS items_count,
  CASE
    WHEN bool_and(t.status = 'received') THEN 'received'
    WHEN bool_and(t.status = 'rejected') THEN 'rejected'
    WHEN bool_or(t.status = 'rejected') AND bool_or(t.status = 'received') THEN 'partially_rejected'
    ELSE 'pending'
  END AS shipment_status,
  b.butcher_1_id, b.butcher_2_id, b.butcher_3_id
FROM (
  SELECT sbt.id, sbt.batch_id, sbt.output_id, sbt.branch_id, sbt.cut_name_ar, sbt.weight_kg, sbt.unit_price,
         sbt.total_value, sbt.transferred_at, COALESCE(sbt.status,'pending') AS status,
         sbt.received_by, sbt.notes,
         (SELECT o.received_at FROM public.slaughter_batch_outputs o WHERE o.id = sbt.output_id) AS received_at_safe
  FROM public.slaughter_branch_transfers sbt
) t
JOIN public.slaughter_batches b ON b.id = t.batch_id
GROUP BY t.batch_id, b.batch_number, b.slaughter_date, t.branch_id, t.transferred_at,
         b.butcher_1_id, b.butcher_2_id, b.butcher_3_id;

GRANT SELECT ON public.v_slaughter_transfer_shipments TO authenticated, anon, service_role;
