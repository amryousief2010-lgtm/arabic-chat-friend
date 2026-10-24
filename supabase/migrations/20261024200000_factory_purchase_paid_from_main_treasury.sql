-- فواتير شراء مصنع اللحوم: طريقة دفع «مدفوع من الخزنة الرئيسية» + ربط بحركة MT
-- الفاتورة دي بتدخل المخزون عادي لكن مش بتسجل خروج فلوس من خزنة المصنع (الفلوس اتصرفت من الرئيسية).

ALTER TABLE public.meat_factory_purchases
  ADD COLUMN IF NOT EXISTS main_treasury_txn_id uuid REFERENCES public.main_treasury_transactions(id);

ALTER TABLE public.meat_factory_purchases DROP CONSTRAINT IF EXISTS meat_factory_purchases_payment_method_check;
ALTER TABLE public.meat_factory_purchases
  ADD CONSTRAINT meat_factory_purchases_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash','credit','transfer','other','main_treasury']));

-- حركة الخزنة الرئيسية الواحدة تتربط بفاتورة واحدة بس (ماعدا الملغاة)
CREATE UNIQUE INDEX IF NOT EXISTS meat_factory_purchases_main_txn_uniq
  ON public.meat_factory_purchases(main_treasury_txn_id)
  WHERE main_treasury_txn_id IS NOT NULL AND status <> 'cancelled';

-- مرشحين للربط/التحذير: مصروفات الخزنة الرئيسية بمبلغ ±tol وتاريخ ±days
CREATE OR REPLACE FUNCTION public.mt_expense_match_candidates(
  p_amount numeric, p_date date, p_amount_tol numeric DEFAULT 50, p_days int DEFAULT 3)
RETURNS TABLE(id uuid, reference_no text, amount numeric, txn_date date, description text, status text, linked_invoice_no text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.reference_no, t.amount, t.txn_date, t.description, t.status,
         (SELECT p.invoice_no FROM meat_factory_purchases p
           WHERE p.main_treasury_txn_id = t.id AND p.status <> 'cancelled' LIMIT 1)
    FROM main_treasury_transactions t
   WHERE t.txn_type IN ('expense','withdrawal')
     AND t.status IN ('pending_approval','approved','posted')
     AND abs(t.amount - p_amount) <= p_amount_tol
     AND t.txn_date BETWEEN p_date - p_days AND p_date + p_days
     AND (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
          OR has_role(auth.uid(),'meat_factory_manager') OR has_role(auth.uid(),'warehouse_supervisor')
          OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager')
          OR has_main_treasury_access(auth.uid()))
   ORDER BY abs(t.amount - p_amount), abs(t.txn_date - p_date)
   LIMIT 20;
$$;

-- العكس: فواتير شراء مصنع بمبلغ وتاريخ قريبين (للتحذير وقت تسجيل مصروف في الرئيسية)
CREATE OR REPLACE FUNCTION public.meat_purchase_match_candidates(
  p_amount numeric, p_date date, p_amount_tol numeric DEFAULT 50, p_days int DEFAULT 3)
RETURNS TABLE(id uuid, invoice_no text, amount numeric, purchase_date date, supplier text, payment_method text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.invoice_no, p.total_amount, p.purchase_date, p.supplier, p.payment_method, p.status
    FROM meat_factory_purchases p
   WHERE p.status <> 'cancelled'
     AND abs(p.total_amount - p_amount) <= p_amount_tol
     AND p.purchase_date BETWEEN p_date - p_days AND p_date + p_days
     AND (has_main_treasury_access(auth.uid())
          OR has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')
          OR has_role(auth.uid(),'accountant') OR has_role(auth.uid(),'financial_manager'))
   ORDER BY abs(p.total_amount - p_amount), abs(p.purchase_date - p_date)
   LIMIT 20;
$$;

GRANT EXECUTE ON FUNCTION public.mt_expense_match_candidates(numeric, date, numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meat_purchase_match_candidates(numeric, date, numeric, int) TO authenticated;

-- الاعتماد: نفس المنطق الحالي + تحقق من الربط لو الدفع من الرئيسية.
-- خروج خزنة المصنع لسه للـ cash بس، فـ main_treasury مش بيسجل خروج من المصنع.
CREATE OR REPLACE FUNCTION public.approve_meat_purchase(p_purchase_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_p RECORD;
  v_line RECORD;
  v_txn uuid;
  v_new_avg numeric;
  v_old_stock numeric;
  v_old_cost numeric;
  v_kind text;
  v_card uuid;
  v_mt RECORD;
BEGIN
  IF NOT (has_role(auth.uid(),'general_manager') OR has_role(auth.uid(),'executive_manager')) THEN
    RAISE EXCEPTION 'الاعتماد متاح للمدير العام أو المدير التنفيذي فقط';
  END IF;

  SELECT * INTO v_p FROM meat_factory_purchases WHERE id = p_purchase_id FOR UPDATE;
  IF v_p.id IS NULL THEN RAISE EXCEPTION 'فاتورة غير موجودة'; END IF;
  IF v_p.status = 'approved' THEN RAISE EXCEPTION 'الفاتورة معتمدة بالفعل'; END IF;
  IF v_p.status = 'rejected' OR v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد فاتورة مرفوضة أو ملغاة';
  END IF;

  IF v_p.payment_method = 'main_treasury' THEN
    IF v_p.main_treasury_txn_id IS NULL THEN
      RAISE EXCEPTION 'اختر حركة الخزنة الرئيسية اللي اتدفعت منها الفاتورة';
    END IF;
    SELECT * INTO v_mt FROM main_treasury_transactions WHERE id = v_p.main_treasury_txn_id;
    IF v_mt.id IS NULL OR v_mt.status IN ('rejected','reversed','draft') THEN
      RAISE EXCEPTION 'حركة الخزنة الرئيسية المربوطة غير صالحة (ملغاة أو مرفوضة)';
    END IF;
  END IF;

  IF v_p.invoice_no IS NULL THEN
    UPDATE meat_factory_purchases SET invoice_no = gen_meat_purchase_invoice_no() WHERE id = p_purchase_id;
  END IF;

  FOR v_line IN SELECT * FROM meat_factory_purchase_lines WHERE purchase_id = p_purchase_id LOOP
    SELECT current_stock, avg_cost, kind INTO v_old_stock, v_old_cost, v_kind
      FROM meat_factory_raw_items WHERE id = v_line.raw_item_id FOR UPDATE;
    IF v_old_stock IS NULL THEN
      RAISE EXCEPTION 'صنف غير موجود في مخزن الخامات: %', v_line.raw_item_name;
    END IF;

    IF COALESCE(v_line.kind, v_kind, 'raw') = 'packaging' THEN
      v_card := public.resolve_packaging_card(v_line.raw_item_id, v_line.raw_item_name, true);
      PERFORM set_config('app.inventory_internal_post', 'on', true);
      PERFORM public.post_inventory_movement(
        v_card, 'in', v_line.quantity, 'purchase',
        p_purchase_id, v_line.id::text,
        'شراء تغليف',
        'فاتورة شراء ' || COALESCE(v_p.invoice_no, ''),
        now(), v_line.unit_price, v_p.supplier, v_p.invoice_no,
        'delta', false, public.packaging_warehouse_id(), NULL, 'packaging', NULL, NULL,
        'purchase', p_purchase_id::text, NULL, NULL, NULL, NULL
      );
      PERFORM set_config('app.inventory_internal_post', 'off', true);
      CONTINUE;
    END IF;

    v_new_avg := CASE WHEN (v_old_stock + v_line.quantity) = 0 THEN v_line.unit_price
                      ELSE ((v_old_stock * v_old_cost) + (v_line.quantity * v_line.unit_price)) / (v_old_stock + v_line.quantity) END;

    PERFORM public.post_meat_raw_movement(
      v_line.raw_item_id, 'IN', v_line.quantity, v_line.unit_price,
      'شراء خامات', 'meat_factory_purchases', p_purchase_id,
      COALESCE(v_line.kind, v_kind, 'raw'), 'delta', NULL, v_new_avg, v_line.raw_item_name
    );
  END LOOP;

  IF v_p.payment_method = 'cash' AND v_p.total_amount > 0 THEN
    INSERT INTO meat_factory_treasury_txns(txn_date, direction, amount, reason, ref_table, ref_id, created_by)
    VALUES (v_p.purchase_date, 'OUT', v_p.total_amount, 'شراء خامات مصنع اللحوم', 'meat_factory_purchases', p_purchase_id, auth.uid())
    RETURNING id INTO v_txn;
  END IF;

  UPDATE meat_factory_purchases
     SET status = 'approved', approved_at = now(), approved_by = auth.uid(), treasury_txn_id = v_txn
   WHERE id = p_purchase_id;

  INSERT INTO meat_factory_audit_log(table_name, row_id, action, new_value, performed_by)
  VALUES (
    'meat_factory_purchases', p_purchase_id, 'approve',
    jsonb_build_object('total', v_p.total_amount, 'supplier', v_p.supplier,
                       'payment_method', v_p.payment_method, 'main_treasury_txn_id', v_p.main_treasury_txn_id),
    auth.uid()
  );

  RETURN p_purchase_id;
END
$function$;
