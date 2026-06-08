
CREATE OR REPLACE FUNCTION public.reverse_feed_sale_item_internal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_feed_name TEXT;
  v_brooding_id UUID;
BEGIN
  SELECT id, destination_type, sale_no, destination_ref_id
    INTO v_sale
  FROM feed_sales
  WHERE id = OLD.sale_id;

  IF v_sale.destination_type IS NULL OR v_sale.destination_type = 'external_customer' THEN
    RETURN OLD;
  END IF;

  SELECT name INTO v_feed_name FROM feed_products WHERE id = OLD.feed_product_id;

  IF v_sale.destination_type = 'brooding_feed_store' THEN
    SELECT id INTO v_brooding_id FROM brooding_feed_inventory WHERE feed_name = v_feed_name;
    IF v_brooding_id IS NOT NULL THEN
      INSERT INTO brooding_feed_stock_movements(
        feed_id, movement_type, quantity_kg, unit_cost, total_cost,
        source_type, source_id, invoice_no, notes
      ) VALUES (
        v_brooding_id, 'reversal', -OLD.quantity, OLD.unit_price, -OLD.quantity * OLD.unit_price,
        'feed_factory_invoice_reversal', OLD.id, v_sale.sale_no,
        'عكس تلقائي لإلغاء بند فاتورة مصنع العلف رقم ' || COALESCE(v_sale.sale_no, '')
      );
    END IF;

  ELSIF v_sale.destination_type = 'slaughterhouse_feed_store' THEN
    INSERT INTO slaughterhouse_feed_movements(
      feed_id, movement_type, quantity_kg, unit_cost, total_cost,
      source_type, source_id, invoice_no, notes
    ) VALUES (
      OLD.feed_product_id, 'reversal', -OLD.quantity, OLD.unit_price, -OLD.quantity * OLD.unit_price,
      'feed_factory_invoice_reversal', OLD.id, v_sale.sale_no,
      'عكس تلقائي لإلغاء بند فاتورة مصنع العلف رقم ' || COALESCE(v_sale.sale_no, '')
    );
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_reverse_feed_sale_item_internal ON public.feed_sale_items;
CREATE TRIGGER trg_reverse_feed_sale_item_internal
AFTER DELETE ON public.feed_sale_items
FOR EACH ROW
EXECUTE FUNCTION public.reverse_feed_sale_item_internal();
