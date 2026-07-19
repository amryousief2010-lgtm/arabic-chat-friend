
-- Link the newly-created late reconciliation IN rows to their courier deposit records
UPDATE public.courier_daily_cash_deposits
SET treasury_txn_id = '76f1b213-5308-4943-8d93-1eb04269d879'
WHERE id = '70325a06-1d5f-4f3e-a830-86fda661dbfb';

UPDATE public.courier_daily_cash_deposits
SET treasury_txn_id = 'e5e0e543-8a6f-4800-bacc-1b653ba5113f'
WHERE id = 'e889b876-8aec-49ec-8760-2ff0908d57a4';

UPDATE public.courier_daily_cash_deposits
SET treasury_txn_id = 'ca7e16e4-14a6-4232-99f5-5b6781f58aab'
WHERE id = '2909b27d-d9ad-416e-8969-6e7e30104ec2';

-- Approve the pending outgoing transfer from main warehouse treasury (13,890)
UPDATE public.main_warehouse_treasury_txns
SET status = 'posted', approved_at = now()
WHERE id = '3b03d482-1621-4f1d-bf4c-3b3c01c24545'
  AND status = 'pending_approval';
