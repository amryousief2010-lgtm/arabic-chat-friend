
CREATE OR REPLACE FUNCTION public.brooding_feed_stock_apply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.movement_type IN ('purchase','opening','factory_supply') THEN
    UPDATE public.brooding_feed_inventory
      SET current_kg = current_kg + NEW.quantity_kg,
          last_unit_cost = COALESCE(NULLIF(NEW.unit_cost, 0), last_unit_cost),
          updated_at = now()
      WHERE id = NEW.feed_id;
  ELSIF NEW.movement_type = 'adjustment' THEN
    UPDATE public.brooding_feed_inventory
      SET current_kg = NEW.quantity_kg, updated_at = now()
      WHERE id = NEW.feed_id;
  ELSIF NEW.movement_type = 'reversal' THEN
    UPDATE public.brooding_feed_inventory
      SET current_kg = current_kg + NEW.quantity_kg, updated_at = now()
      WHERE id = NEW.feed_id;
  END IF;
  RETURN NEW;
END $$;

-- ترقية الرصيد للحركة الموجودة فعلاً لدفعة الاختبار التي لم تُطبَّق بسبب الإصدار السابق
UPDATE public.brooding_feed_inventory bi
   SET current_kg = current_kg + m.quantity_kg,
       last_unit_cost = COALESCE(NULLIF(m.unit_cost,0), bi.last_unit_cost),
       updated_at = now()
  FROM public.brooding_feed_stock_movements m
 WHERE m.feed_id = bi.id
   AND m.movement_type = 'factory_supply'
   AND m.source_type = 'feed_factory_invoice'
   AND m.created_at > now() - interval '15 minutes';
