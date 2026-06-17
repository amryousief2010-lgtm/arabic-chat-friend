
-- Prevent duplicate treasury txn per payment
CREATE UNIQUE INDEX IF NOT EXISTS ux_feed_factory_treasury_payment_ref
  ON public.feed_factory_treasury_txns (ref_table, ref_id, kind)
  WHERE ref_table = 'feed_internal_payments';

-- Trigger: on approve → insert IN treasury txn; on cancel → insert OUT reversal
CREATE OR REPLACE FUNCTION public.feed_internal_payment_sync_treasury()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_txn_id uuid;
  v_party text;
  v_note text;
  v_dept_label text;
BEGIN
  v_dept_label := CASE NEW.department_type
    WHEN 'brooding' THEN 'حضانات التسمين'
    WHEN 'slaughterhouse' THEN 'مخزن علف المجزر'
    ELSE NEW.department_type END;

  -- pending -> approved : create revenue txn (idempotent)
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved' AND OLD.status = 'pending' THEN

    IF NOT EXISTS (
      SELECT 1 FROM feed_factory_treasury_txns
      WHERE ref_table = 'feed_internal_payments' AND ref_id = NEW.id AND kind = 'internal_collection'
    ) THEN
      INSERT INTO feed_factory_treasury_txns
        (txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by)
      VALUES (
        'TRZ-IP-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substr(NEW.id::text, 1, 6),
        COALESCE(NEW.payment_date, CURRENT_DATE),
        'in',
        'internal_collection',
        NEW.amount,
        'feed_internal_payments',
        NEW.id,
        v_dept_label,
        COALESCE('سداد مديونية علف من ' || v_dept_label
                 || COALESCE(' — طريقة: ' || NEW.payment_method, '')
                 || COALESCE(' — مرجع: ' || NEW.reference_no, ''),
                 'سداد مديونية علف'),
        COALESCE(NEW.approved_by, NEW.created_by)
      )
      RETURNING id INTO v_txn_id;
      NEW.treasury_txn_id := v_txn_id;
    END IF;
  END IF;

  -- approved -> cancelled : create reversal OUT txn (idempotent)
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    IF NOT EXISTS (
      SELECT 1 FROM feed_factory_treasury_txns
      WHERE ref_table = 'feed_internal_payments' AND ref_id = NEW.id AND kind = 'internal_collection_reversal'
    ) THEN
      INSERT INTO feed_factory_treasury_txns
        (txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by)
      VALUES (
        'TRZ-IPR-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substr(NEW.id::text, 1, 6),
        CURRENT_DATE,
        'out',
        'internal_collection_reversal',
        NEW.amount,
        'feed_internal_payments',
        NEW.id,
        v_dept_label,
        'عكس سداد مديونية علف — السبب: ' || COALESCE(NEW.rejected_reason, '—'),
        COALESCE(NEW.approved_by, NEW.created_by)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feed_internal_payment_sync_treasury ON public.feed_internal_payments;
CREATE TRIGGER trg_feed_internal_payment_sync_treasury
  BEFORE UPDATE OF status ON public.feed_internal_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.feed_internal_payment_sync_treasury();

-- Backfill: any already-approved payment without a treasury txn
INSERT INTO public.feed_factory_treasury_txns
  (txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by)
SELECT
  'TRZ-IP-' || to_char(now(), 'YYMMDDHH24MISS') || '-' || substr(p.id::text, 1, 6),
  COALESCE(p.payment_date, CURRENT_DATE),
  'in',
  'internal_collection',
  p.amount,
  'feed_internal_payments',
  p.id,
  CASE p.department_type
    WHEN 'brooding' THEN 'حضانات التسمين'
    WHEN 'slaughterhouse' THEN 'مخزن علف المجزر'
    ELSE p.department_type END,
  'سداد مديونية علف (backfill)',
  COALESCE(p.approved_by, p.created_by)
FROM public.feed_internal_payments p
WHERE p.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM public.feed_factory_treasury_txns t
    WHERE t.ref_table = 'feed_internal_payments' AND t.ref_id = p.id AND t.kind = 'internal_collection'
  );

UPDATE public.feed_internal_payments p
SET treasury_txn_id = t.id
FROM public.feed_factory_treasury_txns t
WHERE t.ref_table='feed_internal_payments' AND t.ref_id=p.id AND t.kind='internal_collection'
  AND p.treasury_txn_id IS NULL AND p.status='approved';
