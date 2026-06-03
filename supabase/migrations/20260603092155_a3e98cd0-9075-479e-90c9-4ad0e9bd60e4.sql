ALTER TABLE public.feed_finished_goods_moves DROP CONSTRAINT IF EXISTS feed_finished_goods_moves_movement_type_check;
ALTER TABLE public.feed_finished_goods_moves
  ADD CONSTRAINT feed_finished_goods_moves_movement_type_check
  CHECK (movement_type = ANY (ARRAY['in'::text, 'out'::text, 'transfer'::text, 'adjustment'::text, 'sales_return'::text, 'sales_return_cancel'::text]));

ALTER TABLE public.feed_factory_treasury_txns DROP CONSTRAINT IF EXISTS feed_factory_treasury_txns_kind_check;
ALTER TABLE public.feed_factory_treasury_txns
  ADD CONSTRAINT feed_factory_treasury_txns_kind_check
  CHECK (kind = ANY (ARRAY[
    'sale'::text,
    'purchase'::text,
    'loan_from_naam'::text,
    'loan_to_naam'::text,
    'manual_in'::text,
    'manual_out'::text,
    'opening_balance'::text,
    'other'::text,
    'custody_shoala'::text,
    'custody_gamal'::text,
    'general_expense'::text,
    'tobacco_expense'::text,
    'transport_expense'::text,
    'feed_sales_return_refund'::text,
    'feed_sales_return_cancel'::text
  ]));

CREATE OR REPLACE FUNCTION public.approve_feed_sales_return(p_return_id uuid)
RETURNS public.feed_sales_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.feed_sales_returns;
  v_user uuid := auth.uid();
  v_move_id uuid;
  v_txn_id uuid;
  v_allowed boolean;
  v_batch_id uuid;
BEGIN
  v_allowed := public.has_role(v_user,'general_manager')
            OR public.has_role(v_user,'executive_manager')
            OR public.has_role(v_user,'feed_factory_manager')
            OR public.has_role(v_user,'accountant')
            OR public.has_role(v_user,'financial_manager');
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'غير مصرح باعتماد المرتجع';
  END IF;

  SELECT * INTO v_rec
  FROM public.feed_sales_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود';
  END IF;

  IF v_rec.status = 'approved' OR v_rec.approved_at IS NOT NULL OR v_rec.stock_movement_id IS NOT NULL OR v_rec.cash_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'هذا المرتجع تم اعتماده بالفعل';
  END IF;

  IF v_rec.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد مرتجع بحالة %', v_rec.status;
  END IF;

  SELECT id INTO v_batch_id
  FROM public.feed_invoice_batches
  WHERE feed_product_id = v_rec.feed_product_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_batch_id IS NULL THEN
    RAISE EXCEPTION 'لا توجد دفعة مرتبطة بالصنف المرتجع لتسجيل حركة المخزون';
  END IF;

  UPDATE public.feed_products
  SET current_stock = COALESCE(current_stock, 0) + v_rec.quantity_kg,
      updated_at = now()
  WHERE id = v_rec.feed_product_id;

  INSERT INTO public.feed_finished_goods_moves(
    batch_id,
    feed_product_id,
    movement_type,
    qty_kg,
    destination,
    notes,
    performed_by
  ) VALUES (
    v_batch_id,
    v_rec.feed_product_id,
    'sales_return',
    v_rec.quantity_kg,
    COALESCE(v_rec.treasury_account, 'finished_warehouse'),
    concat('مرتجع مبيعات أعلاف - ', v_rec.customer),
    v_user
  )
  RETURNING id INTO v_move_id;

  INSERT INTO public.feed_factory_treasury_txns(
    txn_no,
    txn_date,
    direction,
    kind,
    amount,
    ref_table,
    ref_id,
    party,
    note,
    created_by
  ) VALUES (
    concat('FSR-OUT-', to_char(now(),'YYMMDDHH24MISS'), '-', substr(v_rec.id::text, 1, 6)),
    v_rec.return_date,
    'out',
    'feed_sales_return_refund',
    v_rec.total_amount,
    'feed_sales_returns',
    v_rec.id,
    v_rec.customer,
    concat('رد قيمة مرتجع أعلاف للعميل ', v_rec.customer),
    v_user
  )
  RETURNING id INTO v_txn_id;

  UPDATE public.feed_sales_returns
  SET status = 'approved',
      approved_at = now(),
      approved_by = v_user,
      stock_movement_id = v_move_id,
      cash_transaction_id = v_txn_id,
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_feed_sales_return(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_feed_sales_return(p_return_id uuid)
RETURNS public.feed_sales_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.feed_sales_returns;
  v_user uuid := auth.uid();
  v_move_id uuid;
  v_txn_id uuid;
  v_batch_id uuid;
BEGIN
  IF NOT (public.has_role(v_user,'general_manager') OR public.has_role(v_user,'executive_manager')) THEN
    RAISE EXCEPTION 'الإلغاء مسموح فقط للمدير العام أو التنفيذي';
  END IF;

  SELECT * INTO v_rec
  FROM public.feed_sales_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود';
  END IF;

  IF v_rec.status = 'cancelled' THEN
    RAISE EXCEPTION 'المرتجع ملغي بالفعل';
  END IF;

  IF v_rec.status = 'approved' THEN
    SELECT id INTO v_batch_id
    FROM public.feed_invoice_batches
    WHERE feed_product_id = v_rec.feed_product_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_batch_id IS NULL THEN
      RAISE EXCEPTION 'لا توجد دفعة مرتبطة بالصنف المرتجع لعكس حركة المخزون';
    END IF;

    UPDATE public.feed_products
    SET current_stock = COALESCE(current_stock,0) - v_rec.quantity_kg,
        updated_at = now()
    WHERE id = v_rec.feed_product_id;

    INSERT INTO public.feed_finished_goods_moves(
      batch_id,
      feed_product_id,
      movement_type,
      qty_kg,
      destination,
      notes,
      performed_by
    ) VALUES (
      v_batch_id,
      v_rec.feed_product_id,
      'sales_return_cancel',
      v_rec.quantity_kg,
      'cancel',
      concat('إلغاء مرتجع مبيعات أعلاف - ', v_rec.customer),
      v_user
    )
    RETURNING id INTO v_move_id;

    INSERT INTO public.feed_factory_treasury_txns(
      txn_no,
      txn_date,
      direction,
      kind,
      amount,
      party,
      note,
      ref_table,
      ref_id,
      created_by
    ) VALUES (
      concat('FSR-CXL-', to_char(now(),'YYMMDDHH24MISS'), '-', substr(v_rec.id::text,1,6)),
      current_date,
      'in',
      'feed_sales_return_cancel',
      v_rec.total_amount,
      v_rec.customer,
      concat('إلغاء رد قيمة مرتجع أعلاف للعميل ', v_rec.customer),
      'feed_sales_returns',
      v_rec.id,
      v_user
    )
    RETURNING id INTO v_txn_id;
  END IF;

  UPDATE public.feed_sales_returns
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_user,
      reverse_stock_movement_id = v_move_id,
      reverse_cash_transaction_id = v_txn_id,
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_feed_sales_return(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fix_feed_sales_return_refund(p_return_id uuid)
RETURNS public.feed_sales_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec public.feed_sales_returns;
  v_user uuid := auth.uid();
  v_existing_txn uuid;
  v_txn_id uuid;
  v_allowed boolean;
BEGIN
  v_allowed := public.has_role(v_user,'general_manager')
            OR public.has_role(v_user,'executive_manager')
            OR public.has_role(v_user,'feed_factory_manager')
            OR public.has_role(v_user,'accountant')
            OR public.has_role(v_user,'financial_manager');
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'غير مصرح بتنفيذ الإصلاح';
  END IF;

  SELECT * INTO v_rec
  FROM public.feed_sales_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المرتجع غير موجود';
  END IF;

  IF v_rec.status <> 'approved' THEN
    RAISE EXCEPTION 'الإصلاح متاح فقط لمرتجع معتمد';
  END IF;

  IF v_rec.cash_transaction_id IS NOT NULL THEN
    SELECT id INTO v_existing_txn
    FROM public.feed_factory_treasury_txns
    WHERE id = v_rec.cash_transaction_id
    LIMIT 1;

    IF v_existing_txn IS NOT NULL THEN
      RETURN v_rec;
    END IF;
  END IF;

  SELECT id INTO v_existing_txn
  FROM public.feed_factory_treasury_txns
  WHERE ref_table = 'feed_sales_returns'
    AND ref_id = v_rec.id
    AND direction = 'out'
    AND kind = 'feed_sales_return_refund'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_txn IS NULL THEN
    INSERT INTO public.feed_factory_treasury_txns(
      txn_no,
      txn_date,
      direction,
      kind,
      amount,
      ref_table,
      ref_id,
      party,
      note,
      created_by
    ) VALUES (
      concat('FSR-FIX-', to_char(now(),'YYMMDDHH24MISS'), '-', substr(v_rec.id::text,1,6)),
      v_rec.return_date,
      'out',
      'feed_sales_return_refund',
      v_rec.total_amount,
      'feed_sales_returns',
      v_rec.id,
      v_rec.customer,
      concat('رد قيمة مرتجع أعلاف للعميل ', v_rec.customer),
      COALESCE(v_rec.approved_by, v_user)
    ) RETURNING id INTO v_txn_id;
  ELSE
    v_txn_id := v_existing_txn;
  END IF;

  UPDATE public.feed_sales_returns
  SET cash_transaction_id = v_txn_id,
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fix_feed_sales_return_refund(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.feed_factory_dashboard_stats()
RETURNS TABLE (
  sales_today numeric,
  sales_month numeric,
  sales_year numeric,
  purchases_today numeric,
  purchases_month numeric,
  purchases_year numeric,
  returns_today numeric,
  returns_month numeric,
  returns_year numeric,
  net_sales_today numeric,
  net_sales_month numeric,
  net_sales_year numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT
    CURRENT_DATE AS today_date,
    date_trunc('month', CURRENT_DATE)::date AS month_start,
    date_trunc('year', CURRENT_DATE)::date AS year_start
),
sales AS (
  SELECT
    COALESCE(SUM(CASE WHEN t.txn_date = b.today_date THEN t.amount ELSE 0 END), 0) AS today_total,
    COALESCE(SUM(CASE WHEN t.txn_date >= b.month_start THEN t.amount ELSE 0 END), 0) AS month_total,
    COALESCE(SUM(CASE WHEN t.txn_date >= b.year_start THEN t.amount ELSE 0 END), 0) AS year_total
  FROM public.feed_factory_treasury_txns t
  CROSS JOIN bounds b
  WHERE t.ref_table = 'feed_sales'
    AND t.direction = 'in'
    AND t.kind = 'sale'
),
purchases AS (
  SELECT
    COALESCE(SUM(CASE WHEN t.txn_date = b.today_date THEN t.amount ELSE 0 END), 0) AS today_total,
    COALESCE(SUM(CASE WHEN t.txn_date >= b.month_start THEN t.amount ELSE 0 END), 0) AS month_total,
    COALESCE(SUM(CASE WHEN t.txn_date >= b.year_start THEN t.amount ELSE 0 END), 0) AS year_total
  FROM public.feed_factory_treasury_txns t
  CROSS JOIN bounds b
  WHERE t.ref_table = 'feed_raw_purchases'
    AND t.direction = 'out'
    AND t.kind = 'purchase'
),
returns AS (
  SELECT
    COALESCE(SUM(CASE WHEN r.return_date = b.today_date THEN r.total_amount ELSE 0 END), 0) AS today_total,
    COALESCE(SUM(CASE WHEN r.return_date >= b.month_start THEN r.total_amount ELSE 0 END), 0) AS month_total,
    COALESCE(SUM(CASE WHEN r.return_date >= b.year_start THEN r.total_amount ELSE 0 END), 0) AS year_total
  FROM public.feed_sales_returns r
  CROSS JOIN bounds b
  WHERE r.status = 'approved'
),
result AS (
  SELECT
    sales.today_total AS sales_today,
    sales.month_total AS sales_month,
    sales.year_total AS sales_year,
    purchases.today_total AS purchases_today,
    purchases.month_total AS purchases_month,
    purchases.year_total AS purchases_year,
    returns.today_total AS returns_today,
    returns.month_total AS returns_month,
    returns.year_total AS returns_year
  FROM sales, purchases, returns
)
SELECT
  sales_today,
  sales_month,
  sales_year,
  purchases_today,
  purchases_month,
  purchases_year,
  returns_today,
  returns_month,
  returns_year,
  sales_today - returns_today AS net_sales_today,
  sales_month - returns_month AS net_sales_month,
  sales_year - returns_year AS net_sales_year
FROM result;
$$;

GRANT EXECUTE ON FUNCTION public.feed_factory_dashboard_stats() TO authenticated;