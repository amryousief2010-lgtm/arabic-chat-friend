-- Add low_stock_threshold column to products table
ALTER TABLE public.products 
ADD COLUMN low_stock_threshold integer NOT NULL DEFAULT 10;

-- Create function to check low stock and create notification
CREATE OR REPLACE FUNCTION public.check_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_notification uuid;
BEGIN
  -- Check if stock is below threshold
  IF NEW.stock <= NEW.low_stock_threshold AND NEW.stock >= 0 THEN
    -- Check if there's already an unread notification for this product
    SELECT id INTO existing_notification
    FROM public.notifications
    WHERE type = 'low_stock' 
      AND description LIKE '%' || NEW.name || '%'
      AND is_read = false
    LIMIT 1;
    
    -- Only create notification if one doesn't exist
    IF existing_notification IS NULL THEN
      INSERT INTO public.notifications (title, description, type)
      VALUES (
        'تنبيه: مخزون منخفض',
        'المنتج "' || NEW.name || '" وصل إلى ' || NEW.stock || ' وحدة فقط (الحد الأدنى: ' || NEW.low_stock_threshold || ')',
        'low_stock'
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to check low stock on update
CREATE TRIGGER check_low_stock_trigger
AFTER UPDATE OF stock ON public.products
FOR EACH ROW
WHEN (NEW.stock IS DISTINCT FROM OLD.stock)
EXECUTE FUNCTION public.check_low_stock();