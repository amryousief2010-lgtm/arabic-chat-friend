
-- Allow 'bonus' as a new line_type
ALTER TABLE public.courier_goods_custody_lines
  DROP CONSTRAINT IF EXISTS courier_goods_custody_lines_line_type_check;

ALTER TABLE public.courier_goods_custody_lines
  ADD CONSTRAINT courier_goods_custody_lines_line_type_check
  CHECK (line_type = ANY (ARRAY['issue'::text,'return'::text,'sale'::text,'cash_collect'::text,'bonus'::text]));

-- New columns for bonus / customer tracking
ALTER TABLE public.courier_goods_custody_lines
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS bonus_reason TEXT,
  ADD COLUMN IF NOT EXISTS bonus_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bonus_approved_by UUID,
  ADD COLUMN IF NOT EXISTS bonus_approved_at TIMESTAMPTZ;

ALTER TABLE public.courier_goods_custody_lines
  DROP CONSTRAINT IF EXISTS cgcl_bonus_status_check;
ALTER TABLE public.courier_goods_custody_lines
  ADD CONSTRAINT cgcl_bonus_status_check
  CHECK (bonus_status = ANY (ARRAY['none'::text,'auto_approved'::text,'pending'::text,'approved'::text,'rejected'::text]));
