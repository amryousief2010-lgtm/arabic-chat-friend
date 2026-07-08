CREATE OR REPLACE VIEW public.v_main_treasury_balance AS
SELECT a.id AS account_id,
   a.name,
   a.account_type,
   a.bank_name,
   a.opening_balance,
   COALESCE(sum(
       CASE
           WHEN t.status = 'posted'::text AND (t.txn_type = ANY (ARRAY['deposit'::text, 'bank_deposit'::text, 'transfer_from_custody'::text, 'settlement'::text, 'incoming'::text])) THEN t.amount
           WHEN t.status = 'posted'::text AND (t.txn_type = ANY (ARRAY['withdrawal'::text, 'expense'::text, 'bank_withdrawal'::text, 'bank_fees'::text, 'loan_installment'::text, 'transfer_to_custody'::text, 'transfer_to_sub_treasury'::text, 'transfer_to_bank'::text])) THEN - t.amount
           WHEN t.status = 'posted'::text AND (t.txn_type = ANY (ARRAY['adjustment'::text, 'balance_correction'::text])) THEN t.amount
           ELSE 0::numeric
       END), 0::numeric) AS net_movements,
   a.opening_balance + COALESCE(sum(
       CASE
           WHEN t.status = 'posted'::text AND (t.txn_type = ANY (ARRAY['deposit'::text, 'bank_deposit'::text, 'transfer_from_custody'::text, 'settlement'::text, 'incoming'::text])) THEN t.amount
           WHEN t.status = 'posted'::text AND (t.txn_type = ANY (ARRAY['withdrawal'::text, 'expense'::text, 'bank_withdrawal'::text, 'bank_fees'::text, 'loan_installment'::text, 'transfer_to_custody'::text, 'transfer_to_sub_treasury'::text, 'transfer_to_bank'::text])) THEN - t.amount
           WHEN t.status = 'posted'::text AND (t.txn_type = ANY (ARRAY['adjustment'::text, 'balance_correction'::text])) THEN t.amount
           ELSE 0::numeric
       END), 0::numeric) AS current_balance,
   COALESCE(sum(
       CASE
           WHEN t.status = 'pending_approval'::text THEN t.amount
           ELSE 0::numeric
       END), 0::numeric) AS pending_amount,
   count(
       CASE
           WHEN t.status = 'pending_approval'::text THEN 1
           ELSE NULL::integer
       END) AS pending_count
  FROM public.main_treasury_accounts a
    LEFT JOIN public.main_treasury_transactions t ON t.account_id = a.id
 GROUP BY a.id, a.name, a.account_type, a.bank_name, a.opening_balance;

GRANT SELECT ON public.v_main_treasury_balance TO authenticated, service_role;