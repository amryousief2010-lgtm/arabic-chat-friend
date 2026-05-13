
-- 1) Add production_status to order_items
ALTER TABLE public.order_items 
ADD COLUMN IF NOT EXISTS production_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.order_items
DROP CONSTRAINT IF EXISTS order_items_production_status_check;

ALTER TABLE public.order_items
ADD CONSTRAINT order_items_production_status_check 
CHECK (production_status IN ('pending','in_progress','completed'));

CREATE INDEX IF NOT EXISTS idx_order_items_production_status 
ON public.order_items(production_status);

-- 2) Stock replenishment log
CREATE TABLE IF NOT EXISTS public.stock_replenishment_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  previous_stock integer NOT NULL DEFAULT 0,
  quantity_added integer NOT NULL,
  new_stock integer NOT NULL,
  performed_by uuid,
  performed_by_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_replenishment_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "view_stock_replenishment_log" ON public.stock_replenishment_log;
CREATE POLICY "view_stock_replenishment_log"
ON public.stock_replenishment_log
FOR SELECT
USING (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'sales_manager'::app_role,'warehouse_supervisor'::app_role,
    'accountant'::app_role,'production_manager'::app_role
  ])
);

DROP POLICY IF EXISTS "insert_stock_replenishment_log" ON public.stock_replenishment_log;
CREATE POLICY "insert_stock_replenishment_log"
ON public.stock_replenishment_log
FOR INSERT
WITH CHECK (
  has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,
    'warehouse_supervisor'::app_role,'production_manager'::app_role
  ])
);

CREATE INDEX IF NOT EXISTS idx_stock_replenishment_product 
ON public.stock_replenishment_log(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_replenishment_created 
ON public.stock_replenishment_log(created_at DESC);

-- 3) Auto notification trigger when order item exceeds available stock
CREATE OR REPLACE FUNCTION public.notify_production_needed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stock integer;
  v_name text;
  v_order_no text;
  v_existing uuid;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;
  
  SELECT stock, name INTO v_stock, v_name 
  FROM public.products WHERE id = NEW.product_id;
  
  IF v_stock IS NULL THEN RETURN NEW; END IF;
  
  -- Trigger when ordered qty exceeds available stock
  IF NEW.quantity::int > v_stock THEN
    SELECT order_number INTO v_order_no FROM public.orders WHERE id = NEW.order_id;
    
    SELECT id INTO v_existing
    FROM public.notifications
    WHERE type = 'production_needed'
      AND order_id = NEW.order_id
      AND description LIKE '%' || v_name || '%'
      AND is_read = false
    LIMIT 1;
    
    IF v_existing IS NULL THEN
      INSERT INTO public.notifications (title, description, type, order_id)
      VALUES (
        'تنبيه: مطلوب تصنيع',
        'الطلب ' || COALESCE(v_order_no,'-') || ' يحتاج تصنيع للصنف "' || v_name || 
        '" (المطلوب: ' || NEW.quantity::int || '، المتاح: ' || v_stock || ')',
        'production_needed',
        NEW.order_id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_production_needed ON public.order_items;
CREATE TRIGGER trg_notify_production_needed
AFTER INSERT ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.notify_production_needed();
