ALTER TABLE public.courier_daily_cash_deposit_lines
  ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.deposit_courier_day_cash(p_custody_id uuid, p_day date, p_notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
  v_authorized BOOLEAN;
  v_courier_name TEXT;
  v_existing RECORD;
  v_amount NUMERIC := 0;
  v_orders_count INT := 0;
  v_order_ids UUID[] := '{}';
  v_order_numbers TEXT[] := '{}';
  v_missing_breakdown INT := 0;
  v_undelivered INT := 0;
  v_txn_id UUID;
  v_deposit_id UUID;
  v_performer_name TEXT;
  v_day_label TEXT;
  v_reference TEXT;
  v_proof_count INT := 0;
  v_lines_count INT := 0;
  r RECORD;
  v_day_str TEXT;
  v_ref TEXT;
  v_note TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_authorized := public.has_role(v_uid, 'general_manager')
               OR public.has_role(v_uid, 'executive_manager')
               OR public.has_role(v_uid, 'financial_manager')
               OR public.has_role(v_uid, 'main_treasury_accountant')
               OR public.has_role(v_uid, 'warehouse_supervisor');

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'ليس لديك صلاحية توريد نقدية المندوب';
  END IF;

  SELECT courier_name
    INTO v_courier_name
    FROM public.courier_goods_custodies
   WHERE id = p_custody_id;

  IF v_courier_name IS NULL THEN
    RAISE EXCEPTION 'العهدة غير موجودة';
  END IF;

  SELECT *
    INTO v_existing
    FROM public.courier_daily_cash_deposits
   WHERE custody_id = p_custody_id
     AND deposit_date = p_day
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'تم توريد فلوس هذا اليوم مسبقاً';
  END IF;

  WITH day_asn AS (
    SELECT a.*, o.id AS oid, o.order_number, o.status AS ostatus, o.total,
           o.collection_method, o.update_status_marker, o.courier_cash_due,
           o.vodafone_cash_amount, o.instapay_amount, o.bank_transfer_amount,
           o.other_amount, o.free_amount, o.deposit_amount
      FROM public.courier_order_assignments a
      JOIN public.orders o ON o.id = a.order_id
     WHERE a.custody_id = p_custody_id
       AND (a.assigned_at::date) = p_day
  )
  SELECT
    COALESCE(SUM(CASE
      WHEN ostatus IN ('delivered','collected','completed')
       AND COALESCE(collection_method,'') <> 'transfer'
       AND COALESCE(collection_method,'') <> 'none'
       AND COALESCE(update_status_marker,'') <> 'gift'
      THEN CASE WHEN collection_method = 'mixed_payment'
                THEN COALESCE(courier_cash_due, 0)
                ELSE COALESCE(total, 0) END
      ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE ostatus IN ('delivered','collected','completed')),
    COALESCE(ARRAY_AGG(oid) FILTER (WHERE ostatus IN ('delivered','collected','completed')), '{}'),
    COALESCE(ARRAY_AGG(order_number) FILTER (WHERE ostatus IN ('delivered','collected','completed')), '{}'),
    COUNT(*) FILTER (
      WHERE ostatus IN ('delivered','collected','completed')
        AND collection_method = 'mixed_payment'
        AND ABS(
          COALESCE(courier_cash_due,0)
          + COALESCE(deposit_amount,0)
          + COALESCE(vodafone_cash_amount,0)
          + COALESCE(instapay_amount,0)
          + COALESCE(bank_transfer_amount,0)
          + COALESCE(other_amount,0)
          + COALESCE(free_amount,0)
          - COALESCE(total,0)
        ) > 0.01
    ),
    COUNT(*) FILTER (WHERE ostatus NOT IN ('delivered','collected','completed','cancelled','partially_returned','fully_returned'))
  INTO v_amount, v_orders_count, v_order_ids, v_order_numbers, v_missing_breakdown, v_undelivered
  FROM day_asn;

  IF v_undelivered > 0 THEN
    RAISE EXCEPTION 'يوجد % أوردر لم يتم تسليمهم بعد — راجع الأوردرات قبل التوريد', v_undelivered;
  END IF;

  IF v_missing_breakdown > 0 THEN
    RAISE EXCEPTION 'يوجد % أوردر دفع مختلط بدون breakdown مضبوط', v_missing_breakdown;
  END IF;

  IF v_orders_count = 0 THEN
    RAISE EXCEPTION 'لا توجد أوردرات مسلّمة في هذا اليوم لتوريدها';
  END IF;

  SELECT COALESCE(full_name, email)
    INTO v_performer_name
    FROM public.profiles
   WHERE id = v_uid;

  v_day_label := to_char(p_day, 'DD/MM/YYYY');
  v_day_str := to_char(p_day, 'YYYYMMDD');
  v_reference := 'CASH-' || v_courier_name || '-' || v_day_str;

  IF v_amount > 0 THEN
    INSERT INTO public.main_warehouse_treasury_txns
      (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
    VALUES
      ('in', 'courier_deposit', v_amount, v_reference,
       COALESCE(p_notes, '') || CASE WHEN COALESCE(p_notes,'')<>'' THEN ' — ' ELSE '' END
         || 'توريد نقدية أوردرات يوم ' || v_day_label || ' — ' || v_courier_name || ' — ' || v_orders_count || ' أوردر',
       v_uid, v_courier_name, 'posted', now())
    RETURNING id INTO v_txn_id;
  END IF;

  FOR r IN
    SELECT o.id AS oid, o.order_number, o.total, o.collection_method,
           o.update_status_marker, o.courier_cash_due,
           COALESCE(o.vodafone_cash_amount,0) AS voda,
           COALESCE(o.instapay_amount,0) AS insta,
           COALESCE(o.bank_transfer_amount,0) AS bank,
           COALESCE(o.other_amount,0) AS other,
           COALESCE(o.free_amount,0) AS freea,
           COALESCE(o.deposit_amount,0) AS deposit,
           COALESCE(c.name, '') AS cust_name
      FROM public.courier_order_assignments a
      JOIN public.orders o ON o.id = a.order_id
      LEFT JOIN public.customers c ON c.id = o.customer_id
     WHERE a.custody_id = p_custody_id
       AND (a.assigned_at::date) = p_day
       AND o.status IN ('delivered','collected','completed')
  LOOP
    IF r.update_status_marker = 'gift' OR r.collection_method = 'none' THEN
      v_ref := 'PROOF-FREE-' || r.order_number || '-' || v_day_str;
      v_note := 'إثبات أوردر مجاني — ' || r.order_number
                || CASE WHEN r.cust_name<>'' THEN ' — العميل ' || r.cust_name ELSE '' END
                || ' — قيمة الأوردر: ' || COALESCE(r.total,0)::text
                || ' — لا يوجد تحصيل نقدي';
      INSERT INTO public.main_warehouse_treasury_txns
        (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
      VALUES ('in','courier_free_order_proof',0,v_ref,v_note,v_uid,v_courier_name,'posted',now())
      ON CONFLICT DO NOTHING;
      v_proof_count := v_proof_count + 1;
      CONTINUE;
    END IF;

    IF r.collection_method = 'mixed_payment' THEN
      IF r.voda > 0 THEN
        v_ref := 'PROOF-VODA-' || r.order_number || '-' || v_day_str;
        v_note := 'إثبات تحصيل فودافون كاش — أوردر ' || r.order_number
                  || CASE WHEN r.cust_name<>'' THEN ' — العميل ' || r.cust_name ELSE '' END
                  || ' — القيمة المحصلة فودافون: ' || r.voda::text
                  || ' — لا تدخل كاش خزنة المخزن';
        INSERT INTO public.main_warehouse_treasury_txns
          (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
        VALUES ('in','courier_vodafone_proof',0,v_ref,v_note,v_uid,v_courier_name,'posted',now())
        ON CONFLICT DO NOTHING;
        v_proof_count := v_proof_count + 1;
      END IF;

      IF r.insta > 0 THEN
        v_ref := 'PROOF-INSTA-' || r.order_number || '-' || v_day_str;
        v_note := 'إثبات تحصيل إنستاباي — أوردر ' || r.order_number
                  || CASE WHEN r.cust_name<>'' THEN ' — العميل ' || r.cust_name ELSE '' END
                  || ' — القيمة المحصلة إنستاباي: ' || r.insta::text;
        INSERT INTO public.main_warehouse_treasury_txns
          (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
        VALUES ('in','courier_instapay_proof',0,v_ref,v_note,v_uid,v_courier_name,'posted',now())
        ON CONFLICT DO NOTHING;
        v_proof_count := v_proof_count + 1;
      END IF;

      IF r.bank > 0 THEN
        v_ref := 'PROOF-BANK-' || r.order_number || '-' || v_day_str;
        v_note := 'إثبات تحويل بنكي — أوردر ' || r.order_number
                  || CASE WHEN r.cust_name<>'' THEN ' — العميل ' || r.cust_name ELSE '' END
                  || ' — القيمة المحصلة بنكي: ' || r.bank::text;
        INSERT INTO public.main_warehouse_treasury_txns
          (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
        VALUES ('in','courier_bank_transfer_proof',0,v_ref,v_note,v_uid,v_courier_name,'posted',now())
        ON CONFLICT DO NOTHING;
        v_proof_count := v_proof_count + 1;
      END IF;

      IF r.other > 0 THEN
        v_ref := 'PROOF-OTHER-' || r.order_number || '-' || v_day_str;
        v_note := 'إثبات تحصيل بطريقة أخرى — أوردر ' || r.order_number
                  || CASE WHEN r.cust_name<>'' THEN ' — العميل ' || r.cust_name ELSE '' END
                  || ' — القيمة: ' || r.other::text;
        INSERT INTO public.main_warehouse_treasury_txns
          (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
        VALUES ('in','courier_other_proof',0,v_ref,v_note,v_uid,v_courier_name,'posted',now())
        ON CONFLICT DO NOTHING;
        v_proof_count := v_proof_count + 1;
      END IF;

      IF r.freea > 0 THEN
        v_ref := 'PROOF-FREE-' || r.order_number || '-' || v_day_str;
        v_note := 'إثبات جزء مجاني — أوردر ' || r.order_number
                  || CASE WHEN r.cust_name<>'' THEN ' — العميل ' || r.cust_name ELSE '' END
                  || ' — القيمة المجانية: ' || r.freea::text;
        INSERT INTO public.main_warehouse_treasury_txns
          (direction, category, amount, reference, notes, performed_by, courier_name, status, performed_at)
        VALUES ('in','courier_free_order_proof',0,v_ref,v_note,v_uid,v_courier_name,'posted',now())
        ON CONFLICT DO NOTHING;
        v_proof_count := v_proof_count + 1;
      END IF;
    END IF;
  END LOOP;

  INSERT INTO public.courier_daily_cash_deposits
    (custody_id, courier_name, deposit_date, amount, orders_count, order_ids, order_numbers,
     treasury_txn_id, performed_by, performed_by_name, notes)
  VALUES
    (p_custody_id, v_courier_name, p_day, v_amount, v_orders_count, v_order_ids, v_order_numbers,
     v_txn_id, v_uid, v_performer_name, p_notes)
  RETURNING id INTO v_deposit_id;

  INSERT INTO public.courier_daily_cash_deposit_lines
    (deposit_id, order_id, order_number, customer_name, order_total, courier_cash_due,
     vodafone_cash_amount, instapay_amount, bank_transfer_amount, free_amount, other_amount,
     deposit_amount, collection_method, status, update_status_marker)
  SELECT v_deposit_id, o.id, o.order_number,
         COALESCE(c.name, ''),
         COALESCE(o.total,0),
         CASE WHEN o.collection_method='mixed_payment' THEN COALESCE(o.courier_cash_due,0)
              WHEN o.update_status_marker='gift' OR o.collection_method='none' THEN 0
              ELSE COALESCE(o.total,0) END,
         COALESCE(o.vodafone_cash_amount,0),
         COALESCE(o.instapay_amount,0),
         COALESCE(o.bank_transfer_amount,0),
         COALESCE(o.free_amount,0),
         COALESCE(o.other_amount,0),
         COALESCE(o.deposit_amount,0),
         o.collection_method, o.status, o.update_status_marker
    FROM public.courier_order_assignments a
    JOIN public.orders o ON o.id = a.order_id
    LEFT JOIN public.customers c ON c.id = o.customer_id
   WHERE a.custody_id = p_custody_id
     AND (a.assigned_at::date) = p_day
     AND o.status IN ('delivered','collected','completed');

  GET DIAGNOSTICS v_lines_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deposit_id', v_deposit_id,
    'treasury_txn_id', v_txn_id,
    'amount', v_amount,
    'orders_count', v_orders_count,
    'proof_count', v_proof_count,
    'lines_count', v_lines_count,
    'reference', v_reference
  );
END;
$function$;