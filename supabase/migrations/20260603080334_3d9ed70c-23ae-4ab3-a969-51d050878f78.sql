
-- =====================================================
-- Feed Sales Returns
-- =====================================================

CREATE TABLE IF NOT EXISTS public.feed_sales_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no text NOT NULL UNIQUE DEFAULT ('FSR-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text,1,4)),
  return_date date NOT NULL DEFAULT current_date,
  customer text NOT NULL,
  original_sale_id uuid REFERENCES public.feed_sales(id) ON DELETE SET NULL,
  original_sale_no text,
  feed_product_id uuid NOT NULL REFERENCES public.feed_products(id),
  quantity_kg numeric NOT NULL CHECK (quantity_kg > 0),
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount numeric GENERATED ALWAYS AS (quantity_kg * unit_price) STORED,
  reason text,
  notes text,
  treasury_account text NOT NULL DEFAULT 'main',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid,
  stock_movement_id uuid REFERENCES public.feed_finished_goods_moves(id) ON DELETE SET NULL,
  cash_transaction_id uuid REFERENCES public.feed_factory_treasury_txns(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid,
  reverse_stock_movement_id uuid REFERENCES public.feed_finished_goods_moves(id) ON DELETE SET NULL,
  reverse_cash_transaction_id uuid REFERENCES public.feed_factory_treasury_txns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fsr_status ON public.feed_sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_fsr_date ON public.feed_sales_returns(return_date DESC);
CREATE INDEX IF NOT EXISTS idx_fsr_product ON public.feed_sales_returns(feed_product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_sales_returns TO authenticated;
GRANT ALL ON public.feed_sales_returns TO service_role;

ALTER TABLE public.feed_sales_returns ENABLE ROW LEVEL SECURITY;

-- Roles allowed to view & manage
CREATE POLICY "feed_returns_select" ON public.feed_sales_returns
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'feed_factory_manager')
    OR public.has_role(auth.uid(),'production_manager')
    OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'financial_manager')
  );

CREATE POLICY "feed_returns_insert" ON public.feed_sales_returns
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'feed_factory_manager')
    OR public.has_role(auth.uid(),'accountant')
    OR public.has_role(auth.uid(),'financial_manager')
  );

CREATE POLICY "feed_returns_update_draft" ON public.feed_sales_returns
  FOR UPDATE TO authenticated
  USING (
    status = 'draft' AND (
      public.has_role(auth.uid(),'general_manager')
      OR public.has_role(auth.uid(),'executive_manager')
      OR public.has_role(auth.uid(),'feed_factory_manager')
      OR public.has_role(auth.uid(),'accountant')
      OR public.has_role(auth.uid(),'financial_manager')
    )
  );

CREATE POLICY "feed_returns_delete_draft" ON public.feed_sales_returns
  FOR DELETE TO authenticated
  USING (
    status = 'draft' AND (
      public.has_role(auth.uid(),'general_manager')
      OR public.has_role(auth.uid(),'executive_manager')
      OR public.has_role(auth.uid(),'feed_factory_manager')
    )
  );

CREATE TRIGGER trg_fsr_updated_at BEFORE UPDATE ON public.feed_sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- Approve function (atomic)
-- =====================================================
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
BEGIN
  v_allowed := public.has_role(v_user,'general_manager')
            OR public.has_role(v_user,'executive_manager')
            OR public.has_role(v_user,'feed_factory_manager')
            OR public.has_role(v_user,'accountant')
            OR public.has_role(v_user,'financial_manager');
  IF NOT v_allowed THEN RAISE EXCEPTION 'غير مصرح باعتماد المرتجع'; END IF;

  -- Lock row
  SELECT * INTO v_rec FROM public.feed_sales_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  IF v_rec.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد مرتجع بحالة %', v_rec.status;
  END IF;
  IF v_rec.approved_at IS NOT NULL OR v_rec.stock_movement_id IS NOT NULL OR v_rec.cash_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'هذا المرتجع تم اعتماده بالفعل';
  END IF;

  -- 1) Increase finished feed stock
  UPDATE public.feed_products
     SET current_stock = COALESCE(current_stock,0) + v_rec.quantity_kg,
         updated_at = now()
   WHERE id = v_rec.feed_product_id;

  -- 2) Record stock movement (IN)
  INSERT INTO public.feed_finished_goods_moves(
    feed_product_id, batch_id, qty_kg, movement_type, destination, notes, performed_by
  )
  SELECT v_rec.feed_product_id,
         (SELECT id FROM public.feed_invoice_batches WHERE feed_product_id = v_rec.feed_product_id ORDER BY created_at DESC LIMIT 1),
         v_rec.quantity_kg,
         'sales_return',
         'finished_warehouse',
         concat('مرتجع مبيعات أعلاف رقم ', v_rec.return_no,
                ' — عميل ', v_rec.customer,
                CASE WHEN v_rec.original_sale_no IS NOT NULL THEN concat(' — فاتورة ', v_rec.original_sale_no) ELSE '' END,
                CASE WHEN v_rec.reason IS NOT NULL THEN concat(' — ', v_rec.reason) ELSE '' END),
         v_user
  RETURNING id INTO v_move_id;

  -- If no batch exists this errors due to NOT NULL on batch_id; fallback: require at least one batch
  IF v_move_id IS NULL THEN
    RAISE EXCEPTION 'تعذر تسجيل حركة المخزون';
  END IF;

  -- 3) Treasury OUT (refund customer)
  INSERT INTO public.feed_factory_treasury_txns(
    txn_no, txn_date, direction, kind, amount, party, note, ref_table, ref_id, created_by
  ) VALUES (
    concat('FSR-OUT-', to_char(now(),'YYMMDDHH24MISS')),
    v_rec.return_date,
    'out',
    'feed_sales_return_refund',
    v_rec.total_amount,
    v_rec.customer,
    concat('رد قيمة مرتجع أعلاف رقم ', v_rec.return_no,
           CASE WHEN v_rec.original_sale_no IS NOT NULL THEN concat(' — فاتورة ', v_rec.original_sale_no) ELSE '' END),
    'feed_sales_returns',
    v_rec.id,
    v_user
  ) RETURNING id INTO v_txn_id;

  -- 4) Finalize
  UPDATE public.feed_sales_returns
     SET status = 'approved',
         approved_at = now(),
         approved_by = v_user,
         stock_movement_id = v_move_id,
         cash_transaction_id = v_txn_id
   WHERE id = p_return_id
   RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_feed_sales_return(uuid) TO authenticated;

-- =====================================================
-- Cancel function (manager only)
-- =====================================================
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
BEGIN
  IF NOT (public.has_role(v_user,'general_manager') OR public.has_role(v_user,'executive_manager')) THEN
    RAISE EXCEPTION 'الإلغاء مسموح فقط للمدير العام أو التنفيذي';
  END IF;

  SELECT * INTO v_rec FROM public.feed_sales_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المرتجع غير موجود'; END IF;
  IF v_rec.status = 'cancelled' THEN RAISE EXCEPTION 'المرتجع ملغي بالفعل'; END IF;

  IF v_rec.status = 'approved' THEN
    -- Reverse stock
    UPDATE public.feed_products
       SET current_stock = COALESCE(current_stock,0) - v_rec.quantity_kg,
           updated_at = now()
     WHERE id = v_rec.feed_product_id;

    INSERT INTO public.feed_finished_goods_moves(
      feed_product_id, batch_id, qty_kg, movement_type, destination, notes, performed_by
    )
    SELECT v_rec.feed_product_id,
           (SELECT id FROM public.feed_invoice_batches WHERE feed_product_id = v_rec.feed_product_id ORDER BY created_at DESC LIMIT 1),
           v_rec.quantity_kg,
           'sales_return_cancel',
           'cancel',
           concat('إلغاء مرتجع مبيعات أعلاف رقم ', v_rec.return_no),
           v_user
    RETURNING id INTO v_move_id;

    -- Reverse treasury (IN)
    INSERT INTO public.feed_factory_treasury_txns(
      txn_no, txn_date, direction, kind, amount, party, note, ref_table, ref_id, created_by
    ) VALUES (
      concat('FSR-CXL-', to_char(now(),'YYMMDDHH24MISS')),
      current_date,
      'in',
      'feed_sales_return_cancel',
      v_rec.total_amount,
      v_rec.customer,
      concat('إلغاء رد قيمة مرتجع أعلاف رقم ', v_rec.return_no),
      'feed_sales_returns',
      v_rec.id,
      v_user
    ) RETURNING id INTO v_txn_id;
  END IF;

  UPDATE public.feed_sales_returns
     SET status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = v_user,
         reverse_stock_movement_id = v_move_id,
         reverse_cash_transaction_id = v_txn_id
   WHERE id = p_return_id
   RETURNING * INTO v_rec;

  RETURN v_rec;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_feed_sales_return(uuid) TO authenticated;
