
ALTER TABLE public.meat_manufacturing_invoices
  ADD COLUMN IF NOT EXISTS legacy_transferred boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.meat_manufacturing_invoices.legacy_transferred IS
  'Marks pre-cutoff invoices that were considered already handed over to the main warehouse before the formal transfer workflow was enforced. No warehouse_transfers row is created for these.';

UPDATE public.meat_manufacturing_invoices
   SET status = 'transferred',
       legacy_transferred = true,
       transferred_at = COALESCE(transferred_at, approved_at, updated_at, created_at),
       transfer_no = COALESCE(transfer_no, 'LEGACY'),
       notes = COALESCE(notes, '') ||
               CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END ||
               '[legacy-backfill] اعتُبرت هذه الفاتورة تم توريدها للمخزن الرئيسي قبل تفعيل زر التوريد.'
 WHERE status = 'approved'
   AND date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')
       < date_trunc('day', now() AT TIME ZONE 'Africa/Cairo');
