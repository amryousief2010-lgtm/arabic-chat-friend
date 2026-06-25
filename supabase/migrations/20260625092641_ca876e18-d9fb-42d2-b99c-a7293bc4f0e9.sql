-- Add customer linkage to courier custody lines for route preparation feature
ALTER TABLE public.courier_goods_custody_lines
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ccgl_customer_id ON public.courier_goods_custody_lines(customer_id);
CREATE INDEX IF NOT EXISTS idx_ccgl_order_id ON public.courier_goods_custody_lines(order_id);