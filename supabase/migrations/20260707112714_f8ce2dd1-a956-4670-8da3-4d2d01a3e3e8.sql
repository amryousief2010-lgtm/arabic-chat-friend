ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;
ALTER TABLE public.order_payment_breakdown_audit ADD COLUMN IF NOT EXISTS old_deposit_amount numeric;
ALTER TABLE public.order_payment_breakdown_audit ADD COLUMN IF NOT EXISTS new_deposit_amount numeric;