
ALTER TABLE public.main_warehouse_treasury_txns
  DROP CONSTRAINT IF EXISTS main_warehouse_treasury_txns_category_check;

ALTER TABLE public.main_warehouse_treasury_txns
  ADD CONSTRAINT main_warehouse_treasury_txns_category_check
  CHECK (category = ANY (ARRAY[
    'direct_sale_cash','courier_deposit',
    'transfer_to_main_treasury','transfer_from_main_warehouse_treasury',
    'manual_adjust','opening_balance','other',
    'courier_vodafone_proof','courier_instapay_proof',
    'courier_bank_transfer_proof','courier_other_proof','courier_free_order_proof',
    'prior_deposit_reconciliation'
  ]));
