
-- ============================================================
-- Main Treasury — Bank Account section
-- ============================================================

-- 1) Bank-specific expense categories
CREATE TABLE IF NOT EXISTS public.main_treasury_bank_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  label text NOT NULL,
  requires_attachment boolean NOT NULL DEFAULT false,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.main_treasury_bank_categories TO authenticated;
GRANT INSERT, UPDATE ON public.main_treasury_bank_categories TO authenticated;
GRANT ALL ON public.main_treasury_bank_categories TO service_role;

ALTER TABLE public.main_treasury_bank_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bank_cats_select_auth" ON public.main_treasury_bank_categories
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "bank_cats_write_treasury" ON public.main_treasury_bank_categories
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'main_treasury_accountant')
    OR public.has_role(auth.uid(),'main_treasury_approver')
    OR public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
  );

CREATE POLICY "bank_cats_update_admin" ON public.main_treasury_bank_categories
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'main_treasury_approver')
    OR public.has_role(auth.uid(),'general_manager')
    OR public.has_role(auth.uid(),'executive_manager')
    OR public.has_role(auth.uid(),'financial_manager')
  );

-- Seed default bank categories
INSERT INTO public.main_treasury_bank_categories (code, label, sort_order, requires_attachment) VALUES
  ('loan_installment','قسط قرض',1,true),
  ('bank_fees','رسوم بنكية',2,false),
  ('transfer_fees','مصاريف تحويل',3,false),
  ('bank_commission','عمولة بنك',4,false),
  ('loan_interest','فوائد قرض',5,false),
  ('checkbook_fees','مصاريف دفتر شيكات',6,false),
  ('statement_fees','مصاريف كشف حساب',7,false),
  ('admin_bank_fees','مصاريف إدارية بنكية',8,false),
  ('other_bank','أخرى',99,false)
ON CONFLICT (code) DO NOTHING;

-- 2) Extend main_treasury_transactions
ALTER TABLE public.main_treasury_transactions
  ADD COLUMN IF NOT EXISTS bank_category_id uuid REFERENCES public.main_treasury_bank_categories(id),
  ADD COLUMN IF NOT EXISTS loan_number text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mt_txn_client_uuid
  ON public.main_treasury_transactions(client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 3) Update balance view to cover new txn types (bank-specific)
CREATE OR REPLACE VIEW public.v_main_treasury_balance AS
SELECT a.id AS account_id,
       a.name,
       a.account_type,
       a.bank_name,
       a.opening_balance,
       COALESCE(sum(
         CASE
           WHEN t.status = 'posted' AND t.txn_type IN ('deposit','bank_deposit','transfer_from_custody','settlement') THEN t.amount
           WHEN t.status = 'posted' AND t.txn_type IN ('withdrawal','expense','bank_withdrawal','bank_fees','loan_installment','transfer_to_custody','transfer_to_sub_treasury') THEN -t.amount
           WHEN t.status = 'posted' AND t.txn_type IN ('adjustment','balance_correction') THEN t.amount
           ELSE 0
         END), 0) AS net_movements,
       a.opening_balance + COALESCE(sum(
         CASE
           WHEN t.status = 'posted' AND t.txn_type IN ('deposit','bank_deposit','transfer_from_custody','settlement') THEN t.amount
           WHEN t.status = 'posted' AND t.txn_type IN ('withdrawal','expense','bank_withdrawal','bank_fees','loan_installment','transfer_to_custody','transfer_to_sub_treasury') THEN -t.amount
           WHEN t.status = 'posted' AND t.txn_type IN ('adjustment','balance_correction') THEN t.amount
           ELSE 0
         END), 0) AS current_balance,
       COALESCE(sum(
         CASE WHEN t.status='pending_approval' THEN t.amount ELSE 0 END
       ),0) AS pending_amount,
       count(CASE WHEN t.status='pending_approval' THEN 1 END) AS pending_count
FROM public.main_treasury_accounts a
LEFT JOIN public.main_treasury_transactions t ON t.account_id = a.id
WHERE a.is_active
GROUP BY a.id, a.name, a.account_type, a.bank_name, a.opening_balance;

-- 4) Approval: forbid self-approval (creator cannot approve own txn)
CREATE OR REPLACE FUNCTION public.mt_approve_txn(p_txn_id uuid)
 RETURNS public.main_treasury_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t public.main_treasury_transactions;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;

  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة غير موجودة'; END IF;
  IF t.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'المعاملة ليست في حالة انتظار اعتماد (الحالة: %)', t.status;
  END IF;
  IF t.created_by = auth.uid() THEN
    RAISE EXCEPTION 'لا يمكن اعتماد حركة سجلتها بنفسك';
  END IF;

  IF t.requires_dual_approval THEN
    IF t.approver_1_id IS NULL THEN
      UPDATE public.main_treasury_transactions
        SET approver_1_id = auth.uid(), approver_1_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    ELSIF t.approver_1_id = auth.uid() THEN
      RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف';
    ELSE
      UPDATE public.main_treasury_transactions
        SET approver_2_id = auth.uid(), approver_2_at = now(),
            status = 'posted', posted_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    END IF;
  ELSE
    UPDATE public.main_treasury_transactions
      SET approver_1_id = auth.uid(), approver_1_at = now(),
          status = 'posted', posted_at = now()
      WHERE id = p_txn_id RETURNING * INTO t;
    RETURN t;
  END IF;
END;
$function$;

-- 5) updated_at trigger for new table
DROP TRIGGER IF EXISTS trg_mt_bank_categories_updated ON public.main_treasury_bank_categories;
CREATE TRIGGER trg_mt_bank_categories_updated
  BEFORE UPDATE ON public.main_treasury_bank_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
