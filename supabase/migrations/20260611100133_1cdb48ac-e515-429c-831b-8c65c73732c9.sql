
-- 1. Add idempotency link from custody openings to lab movement
ALTER TABLE public.slaughter_custody_opening_balances
  ADD COLUMN IF NOT EXISTS source_lab_movement_id uuid UNIQUE;

-- 2. Lab treasury -> custody transfers table
CREATE TABLE IF NOT EXISTS public.lab_treasury_to_custody_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_movement_id uuid NOT NULL UNIQUE REFERENCES public.lab_treasury_movements(id) ON DELETE RESTRICT,
  custody_keeper_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL DEFAULT 'cash',
  transfer_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'sent',
  received_at timestamptz,
  received_by uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.lab_treasury_to_custody_transfers TO authenticated;
GRANT ALL ON public.lab_treasury_to_custody_transfers TO service_role;

ALTER TABLE public.lab_treasury_to_custody_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lab_to_custody_select_involved" ON public.lab_treasury_to_custody_transfers
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'lab_treasury_approver')
    OR public.has_role(auth.uid(),'slaughterhouse_custody_keeper')
    OR public.has_role(auth.uid(),'slaughterhouse_manager')
    OR auth.uid() = created_by
    OR auth.uid() = custody_keeper_id
  );

CREATE POLICY "lab_to_custody_insert_lab_mgmt" ON public.lab_treasury_to_custody_transfers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'lab_treasury_approver')
  );

CREATE POLICY "lab_to_custody_update_keeper_or_mgmt" ON public.lab_treasury_to_custody_transfers
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'lab_treasury_approver')
    OR (public.has_role(auth.uid(),'slaughterhouse_custody_keeper') AND auth.uid() = custody_keeper_id)
  );

-- 3. Create transfer (debits lab treasury via approved movement + transfer row)
CREATE OR REPLACE FUNCTION public.create_lab_to_custody_transfer(
  p_amount numeric,
  p_transfer_date date,
  p_custody_keeper_id uuid,
  p_payment_method text DEFAULT 'cash',
  p_notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mov_id uuid;
  v_xfer_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (
    public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
    OR public.has_role(v_uid,'lab_treasury_approver')
  ) THEN
    RAISE EXCEPTION 'insufficient privileges to transfer from lab treasury';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  -- create approved expense movement in lab treasury
  INSERT INTO public.lab_treasury_movements (
    movement_type, movement_date, expense_category, beneficiary,
    amount, payment_method, description, notes, status,
    created_by, approved_by, approved_at
  ) VALUES (
    'expense', COALESCE(p_transfer_date, CURRENT_DATE), 'other', 'خزنة عهدة المجزر',
    p_amount, COALESCE(p_payment_method,'cash')::lab_treasury_payment_method,
    'تحويل من خزنة المعمل إلى خزنة عهدة المجزر',
    p_notes, 'approved',
    v_uid, v_uid, now()
  ) RETURNING id INTO v_mov_id;

  INSERT INTO public.lab_treasury_to_custody_transfers (
    lab_movement_id, custody_keeper_id, amount, payment_method,
    transfer_date, status, notes, created_by
  ) VALUES (
    v_mov_id, p_custody_keeper_id, p_amount, COALESCE(p_payment_method,'cash'),
    COALESCE(p_transfer_date, CURRENT_DATE), 'sent', p_notes, v_uid
  ) RETURNING id INTO v_xfer_id;

  RETURN v_xfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lab_to_custody_transfer(numeric,date,uuid,text,text) TO authenticated;

-- 4. Confirm receipt -> adds to custody balance via opening balance row
CREATE OR REPLACE FUNCTION public.confirm_lab_to_custody_transfer(p_transfer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  r record;
  v_cash numeric := 0; v_vc numeric := 0; v_ip numeric := 0; v_bt numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT (
    public.has_role(v_uid,'slaughterhouse_custody_keeper')
    OR public.has_role(v_uid,'general_manager')
    OR public.has_role(v_uid,'executive_manager')
  ) THEN
    RAISE EXCEPTION 'insufficient privileges to confirm';
  END IF;

  SELECT * INTO r FROM public.lab_treasury_to_custody_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transfer not found'; END IF;
  IF r.status = 'received' THEN RETURN; END IF;

  UPDATE public.lab_treasury_to_custody_transfers
    SET status='received', received_at=now(), received_by=v_uid
    WHERE id = p_transfer_id;

  IF r.payment_method = 'vodafone_cash' THEN v_vc := r.amount;
  ELSIF r.payment_method = 'instapay' THEN v_ip := r.amount;
  ELSIF r.payment_method = 'bank_transfer' THEN v_bt := r.amount;
  ELSE v_cash := r.amount; END IF;

  INSERT INTO public.slaughter_custody_opening_balances (
    as_of_date, total_amount, cash_amount, vodafone_cash_amount,
    instapay_amount, bank_transfer_amount, status, notes,
    created_by, approved_by, approved_at, source_lab_movement_id
  ) VALUES (
    r.transfer_date, r.amount, v_cash, v_vc, v_ip, v_bt,
    'approved',
    'تحويل وارد من خزنة المعمل' || COALESCE(' — ' || r.notes, ''),
    v_uid, v_uid, now(), r.lab_movement_id
  )
  ON CONFLICT (source_lab_movement_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_lab_to_custody_transfer(uuid) TO authenticated;
