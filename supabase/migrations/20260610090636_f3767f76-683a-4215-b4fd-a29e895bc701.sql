-- Auto-credit custody on approved transfer_to_custody (idempotent)

ALTER TABLE public.slaughter_custody_opening_balances
  ADD COLUMN IF NOT EXISTS source_main_txn_id uuid
    REFERENCES public.main_treasury_transactions(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scob_source_main_txn
  ON public.slaughter_custody_opening_balances(source_main_txn_id)
  WHERE source_main_txn_id IS NOT NULL;

-- Protect auto-created custody rows from manual edits/deletes
CREATE OR REPLACE FUNCTION public.protect_custody_transfer_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.source_main_txn_id IS NOT NULL
       AND current_setting('app.allow_custody_transfer_mutation', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'لا يمكن حذف صف توريد مرتبط بحركة خزنة رئيسية مباشرة';
    END IF;
    RETURN OLD;
  ELSE
    IF OLD.source_main_txn_id IS NOT NULL
       AND current_setting('app.allow_custody_transfer_mutation', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'لا يمكن تعديل صف توريد مرتبط بحركة خزنة رئيسية مباشرة';
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_custody_transfer_rows
  ON public.slaughter_custody_opening_balances;
CREATE TRIGGER trg_protect_custody_transfer_rows
  BEFORE UPDATE OR DELETE ON public.slaughter_custody_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.protect_custody_transfer_rows();

-- Trigger on main_treasury_transactions: credit custody on posted, reverse on reversed
CREATE OR REPLACE FUNCTION public.mt_sync_custody_transfer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF NEW.txn_type <> 'transfer_to_custody' THEN
    RETURN NEW;
  END IF;

  v_actor := COALESCE(NEW.approver_2_id, NEW.approver_1_id, auth.uid(), NEW.created_by);

  -- Credit custody when posting (idempotent via UNIQUE on source_main_txn_id)
  IF NEW.status = 'posted' AND COALESCE(OLD.status, '') <> 'posted' THEN
    INSERT INTO public.slaughter_custody_opening_balances(
      as_of_date, total_amount, cash_amount, status, notes,
      created_by, approved_by, approved_at, source_main_txn_id
    ) VALUES (
      NEW.txn_date, NEW.amount, NEW.amount, 'approved'::slaughter_custody_status,
      'توريد من الخزنة الرئيسية #' || COALESCE(NEW.reference_no, NEW.id::text)
        || COALESCE(' - ' || NULLIF(NEW.counterparty,''), ''),
      NEW.created_by, v_actor, now(), NEW.id
    )
    ON CONFLICT (source_main_txn_id) WHERE source_main_txn_id IS NOT NULL DO NOTHING;

    -- Mark link row as received (create if missing)
    INSERT INTO public.main_treasury_to_custody_transfers(
      main_txn_id, custody_keeper_id, amount, transfer_date, status, received_at, received_by, notes
    ) VALUES (
      NEW.id, COALESCE(NEW.created_by, v_actor), NEW.amount, NEW.txn_date,
      'received', now(), v_actor, NEW.counterparty
    )
    ON CONFLICT (main_txn_id) DO UPDATE SET
      status = 'received', received_at = now(), received_by = EXCLUDED.received_by;

    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (NEW.id, 'custody_credit_created', v_actor,
      jsonb_build_object('amount', NEW.amount, 'recipient', NEW.counterparty));
  END IF;

  -- Reverse: remove the linked custody opening row
  IF NEW.status = 'reversed' AND OLD.status = 'posted' THEN
    PERFORM set_config('app.allow_custody_transfer_mutation', 'on', true);
    DELETE FROM public.slaughter_custody_opening_balances WHERE source_main_txn_id = NEW.id;
    PERFORM set_config('app.allow_custody_transfer_mutation', 'off', true);

    UPDATE public.main_treasury_to_custody_transfers
      SET status = 'rejected', notes = COALESCE(notes,'') || ' [reversed]'
      WHERE main_txn_id = NEW.id;

    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (NEW.id, 'custody_credit_reversed', v_actor,
      jsonb_build_object('amount', NEW.amount));
  END IF;

  RETURN NEW;
END;
$$;

-- Add unique on main_txn_id to enable ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS uq_mttc_main_txn
  ON public.main_treasury_to_custody_transfers(main_txn_id);

DROP TRIGGER IF EXISTS trg_mt_sync_custody_transfer ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_sync_custody_transfer
  AFTER UPDATE OF status ON public.main_treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mt_sync_custody_transfer();

-- Backfill: any already-posted transfer_to_custody that wasn't credited yet
INSERT INTO public.slaughter_custody_opening_balances(
  as_of_date, total_amount, cash_amount, status, notes,
  created_by, approved_by, approved_at, source_main_txn_id
)
SELECT t.txn_date, t.amount, t.amount, 'approved'::slaughter_custody_status,
       'توريد من الخزنة الرئيسية #' || COALESCE(t.reference_no, t.id::text),
       t.created_by, COALESCE(t.approver_2_id, t.approver_1_id, t.created_by), COALESCE(t.posted_at, now()), t.id
FROM public.main_treasury_transactions t
WHERE t.txn_type = 'transfer_to_custody'
  AND t.status = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM public.slaughter_custody_opening_balances s WHERE s.source_main_txn_id = t.id
  );