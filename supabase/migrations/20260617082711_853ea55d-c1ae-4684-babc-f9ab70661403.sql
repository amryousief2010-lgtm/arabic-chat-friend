
CREATE OR REPLACE FUNCTION public.feed_internal_payment_sync_treasury()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_txn_id uuid;
  v_dept_label text;
  v_main_cash_account uuid;
  v_lab_method text;
  v_actor uuid;
BEGIN
  v_dept_label := CASE NEW.department_type
    WHEN 'brooding' THEN 'حضانات التسمين'
    WHEN 'slaughterhouse' THEN 'مخزن علف المجزر'
    ELSE NEW.department_type END;
  v_actor := COALESCE(NEW.approved_by, NEW.created_by);

  -- pending -> approved
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved' AND OLD.status = 'pending' THEN

    -- (1) Feed factory IN (idempotent)
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
        'سداد مديونية علف من ' || v_dept_label
          || COALESCE(' — طريقة: ' || NEW.payment_method, '')
          || COALESCE(' — مرجع: ' || NEW.reference_no, ''),
        v_actor
      )
      RETURNING id INTO v_txn_id;
      NEW.treasury_txn_id := v_txn_id;
    END IF;

    -- Skip counterpart for internal_settlement (no actual cash moved)
    IF NEW.payment_method = 'internal_settlement' THEN
      RETURN NEW;
    END IF;

    -- (2a) Brooding -> Lab treasury OUT (expense)
    IF NEW.department_type = 'brooding' THEN
      IF NOT EXISTS (
        SELECT 1 FROM lab_treasury_movements
        WHERE source_table = 'feed_internal_payments' AND source_id = NEW.id
      ) THEN
        v_lab_method := CASE NEW.payment_method
          WHEN 'cash' THEN 'cash'
          WHEN 'vodafone_cash' THEN 'vodafone_cash'
          WHEN 'instapay' THEN 'instapay'
          WHEN 'bank_transfer' THEN 'bank_transfer'
          ELSE 'cash' END;

        INSERT INTO lab_treasury_movements
          (movement_type, movement_date, expense_category, amount, payment_method,
           description, beneficiary, notes, status,
           source_table, source_id, source_ref,
           created_by, approved_by, approved_at)
        VALUES (
          'expense'::lab_treasury_movement_type,
          COALESCE(NEW.payment_date, CURRENT_DATE),
          'feed_supplies'::lab_treasury_expense_category,
          NEW.amount,
          v_lab_method::lab_treasury_payment_method,
          'سداد علف لمصنع العلف — ' || v_dept_label,
          'مصنع العلف',
          COALESCE('مرجع: ' || NEW.reference_no, '') || COALESCE(' — ' || NEW.notes, ''),
          'approved'::lab_treasury_status,
          'feed_internal_payments', NEW.id, NEW.payment_no,
          v_actor, v_actor, now()
        );
      END IF;

    -- (2b) Slaughterhouse -> Main treasury OUT (expense, posted)
    ELSIF NEW.department_type = 'slaughterhouse' THEN
      IF NOT EXISTS (
        SELECT 1 FROM main_treasury_transactions
        WHERE reference_no = 'FEEDPAY-MAIN-OUT-' || NEW.id::text
      ) THEN
        SELECT id INTO v_main_cash_account FROM main_treasury_accounts
          WHERE account_type = 'cash' ORDER BY created_at LIMIT 1;

        IF v_main_cash_account IS NOT NULL THEN
          INSERT INTO main_treasury_transactions
            (reference_no, account_id, txn_type, amount, txn_date, counterparty,
             description, status, payment_method, posted_at, created_by)
          VALUES (
            'FEEDPAY-MAIN-OUT-' || NEW.id::text,
            v_main_cash_account,
            'expense',
            NEW.amount,
            COALESCE(NEW.payment_date, CURRENT_DATE),
            'مصنع العلف',
            'سداد علف المجزر لمصنع العلف — مرجع: ' || COALESCE(NEW.reference_no, NEW.payment_no),
            'posted',
            NEW.payment_method,
            now(),
            v_actor
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- approved -> cancelled : reversals
  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    -- Feed factory reversal OUT
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
        v_actor
      );
    END IF;

    IF NEW.payment_method <> 'internal_settlement' OR NEW.payment_method IS NULL THEN
      -- Lab treasury reversal IN
      IF NEW.department_type = 'brooding' THEN
        IF NOT EXISTS (
          SELECT 1 FROM lab_treasury_movements
          WHERE source_table = 'feed_internal_payments_reversal' AND source_id = NEW.id
        ) THEN
          v_lab_method := CASE NEW.payment_method
            WHEN 'cash' THEN 'cash'
            WHEN 'vodafone_cash' THEN 'vodafone_cash'
            WHEN 'instapay' THEN 'instapay'
            WHEN 'bank_transfer' THEN 'bank_transfer'
            ELSE 'cash' END;
          INSERT INTO lab_treasury_movements
            (movement_type, movement_date, income_category, amount, payment_method,
             description, customer_name, notes, status,
             source_table, source_id, source_ref,
             created_by, approved_by, approved_at)
          VALUES (
            'income'::lab_treasury_movement_type,
            CURRENT_DATE,
            'other'::lab_treasury_income_category,
            NEW.amount,
            v_lab_method::lab_treasury_payment_method,
            'عكس سداد علف ملغى — ' || v_dept_label,
            'مصنع العلف',
            'إلغاء سداد رقم ' || NEW.payment_no,
            'approved'::lab_treasury_status,
            'feed_internal_payments_reversal', NEW.id, NEW.payment_no,
            v_actor, v_actor, now()
          );
        END IF;
      ELSIF NEW.department_type = 'slaughterhouse' THEN
        IF NOT EXISTS (
          SELECT 1 FROM main_treasury_transactions
          WHERE reference_no = 'FEEDPAY-MAIN-REV-' || NEW.id::text
        ) THEN
          SELECT id INTO v_main_cash_account FROM main_treasury_accounts
            WHERE account_type = 'cash' ORDER BY created_at LIMIT 1;
          IF v_main_cash_account IS NOT NULL THEN
            INSERT INTO main_treasury_transactions
              (reference_no, account_id, txn_type, amount, txn_date, counterparty,
               description, status, payment_method, posted_at, created_by)
            VALUES (
              'FEEDPAY-MAIN-REV-' || NEW.id::text,
              v_main_cash_account,
              'deposit',
              NEW.amount,
              CURRENT_DATE,
              'مصنع العلف',
              'عكس سداد علف المجزر ملغى — رقم ' || NEW.payment_no,
              'posted',
              NEW.payment_method,
              now(),
              v_actor
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Make sure the trigger is wired (it already exists from prior migration; harmless re-create)
DROP TRIGGER IF EXISTS trg_feed_internal_payment_sync_treasury ON public.feed_internal_payments;
CREATE TRIGGER trg_feed_internal_payment_sync_treasury
BEFORE UPDATE OF status ON public.feed_internal_payments
FOR EACH ROW EXECUTE FUNCTION public.feed_internal_payment_sync_treasury();
