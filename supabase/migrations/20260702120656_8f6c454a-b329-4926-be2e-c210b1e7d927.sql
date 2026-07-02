ALTER TABLE public.courier_daily_cash_deposits
  ADD COLUMN IF NOT EXISTS transferred_txn_id UUID REFERENCES public.main_warehouse_treasury_txns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ccd_transferred_txn ON public.courier_daily_cash_deposits(transferred_txn_id);