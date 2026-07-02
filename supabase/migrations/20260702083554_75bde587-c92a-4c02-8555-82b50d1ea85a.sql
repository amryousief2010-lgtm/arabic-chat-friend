
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS bank_transfer_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transfer_reference text;

ALTER TABLE public.order_payment_breakdown_audit
  ADD COLUMN IF NOT EXISTS old_bank_transfer_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS new_bank_transfer_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS old_other_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS new_other_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS transfer_reference text;
