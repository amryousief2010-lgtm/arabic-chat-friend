
ALTER TABLE public.slaughter_batches
  ADD COLUMN IF NOT EXISTS evaluation_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS evaluation_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS evaluation_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_saved_by uuid,
  ADD COLUMN IF NOT EXISTS evaluation_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_approved_by uuid,
  ADD COLUMN IF NOT EXISTS evaluation_approval_note text;

ALTER TABLE public.slaughter_batches
  DROP CONSTRAINT IF EXISTS slaughter_batches_evaluation_status_check;
ALTER TABLE public.slaughter_batches
  ADD CONSTRAINT slaughter_batches_evaluation_status_check
  CHECK (evaluation_status IN ('draft','saved','approved'));
