
CREATE TABLE IF NOT EXISTS public.order_status_stage (
  created_at timestamptz,
  status text
);
ALTER TABLE public.order_status_stage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON public.order_status_stage FOR ALL USING (false);
CREATE INDEX IF NOT EXISTS idx_order_status_stage_created_at ON public.order_status_stage(created_at);
