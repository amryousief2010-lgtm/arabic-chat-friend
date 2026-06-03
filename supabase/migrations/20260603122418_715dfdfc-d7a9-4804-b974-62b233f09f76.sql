
-- Fix brooding batch add trigger
CREATE OR REPLACE FUNCTION public.log_brooding_batch_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_qty numeric;
  v_cost numeric;
  v_total numeric;
BEGIN
  v_qty := COALESCE(NEW.original_count, 0);
  v_cost := COALESCE(NEW.cost_per_bird, 0);
  v_total := COALESCE(NEW.total_cost, v_qty * v_cost);

  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'batch_add', 'IN', NEW.id,
    'كتاكيت — ' || COALESCE(NEW.batch_number, ''),
    v_qty, 'كتكوت', v_cost, v_total,
    COALESCE(NEW.source, 'خارجي'), 'التحضين والتسمين',
    NEW.created_by, 'brooding_batches', NEW.id,
    NEW.notes
  );
  RETURN NEW;
END $$;

-- Fix mortality trigger
CREATE OR REPLACE FUNCTION public.log_brooding_mortality_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_no text;
BEGIN
  SELECT batch_number INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'mortality', 'OUT', NEW.batch_id,
    'نافق — دفعة ' || COALESCE(v_batch_no,''),
    COALESCE(NEW.count, 0), 'كتكوت',
    NEW.created_by, 'brooding_mortality', NEW.id,
    NEW.reason
  );
  RETURN NEW;
END $$;

-- Fix feed issuance trigger
CREATE OR REPLACE FUNCTION public.log_brooding_feed_issuance_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch_no text;
BEGIN
  SELECT batch_number INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;

  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'feed_issue', 'OUT', NEW.batch_id,
    'علف — ' || COALESCE(NEW.feed_name, ''),
    COALESCE(NEW.quantity_kg, 0), 'كجم',
    COALESCE(NEW.unit_cost, 0), COALESCE(NEW.total_cost, 0),
    'مخزون علف التحضين', 'دفعة ' || COALESCE(v_batch_no,''),
    NEW.created_by, 'brooding_feed_issuance', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

-- Fix medicine trigger
CREATE OR REPLACE FUNCTION public.log_brooding_medicine_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_no text;
BEGIN
  SELECT batch_number INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost, created_by,
    source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'medicine_issue', 'OUT', NEW.batch_id,
    'دواء — ' || COALESCE(NEW.medicine_name, ''),
    COALESCE(NEW.quantity, 0), COALESCE(NEW.unit, 'وحدة'),
    COALESCE(NEW.unit_cost, 0), COALESCE(NEW.total_cost, 0),
    NEW.created_by, 'brooding_medicine_issuance', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

-- Fix expense trigger
CREATE OR REPLACE FUNCTION public.log_brooding_expense_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, total_cost, created_by,
    source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'expense', 'OUT', NEW.batch_id,
    COALESCE(NEW.item_name, NEW.expense_type::text, 'مصروف'),
    COALESCE(NEW.quantity, 1), 'بند', COALESCE(NEW.total_amount, 0),
    NEW.created_by, 'brooding_expenses', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

-- Fix chick sale trigger
CREATE OR REPLACE FUNCTION public.log_brooding_chick_sale_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_no text;
BEGIN
  SELECT batch_number INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'chicks_sale', 'OUT', NEW.batch_id,
    'بيع كتاكيت — دفعة ' || COALESCE(v_batch_no,''),
    COALESCE(NEW.count, 0), 'كتكوت',
    COALESCE(NEW.unit_price, 0), COALESCE(NEW.total_amount, 0),
    'التحضين والتسمين', COALESCE(NEW.customer_name, 'عميل'),
    NEW.created_by, 'brooding_chick_sales', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

-- Fix slaughter transfer trigger
CREATE OR REPLACE FUNCTION public.log_brooding_slaughter_transfer_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch_no text;
BEGIN
  SELECT batch_number INTO v_batch_no FROM public.brooding_batches WHERE id = NEW.batch_id;
  INSERT INTO public.brooding_movements (
    movement_no, movement_type, direction, batch_id, item_name,
    quantity, unit, unit_cost, total_cost,
    from_party, to_party, created_by, source_table, source_id, notes
  ) VALUES (
    next_brooding_movement_no(), 'slaughter_transfer', 'OUT', NEW.batch_id,
    'تحويل للمجزر — دفعة ' || COALESCE(v_batch_no,''),
    COALESCE(NEW.count, 0), 'طائر',
    CASE WHEN COALESCE(NEW.count,0) > 0 THEN COALESCE(NEW.transferred_cost,0)/NEW.count ELSE 0 END,
    COALESCE(NEW.transferred_cost, 0),
    'التحضين والتسمين', 'المجزر',
    NEW.created_by, 'brooding_to_slaughter_transfers', NEW.id, NEW.notes
  );
  RETURN NEW;
END $$;

-- Fix feed stock movement trigger (feed_inventory uses feed_name, not name)
CREATE OR REPLACE FUNCTION public.log_brooding_feed_stock_movement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_feed_name text;
  v_ref text;
  v_br_id uuid;
  v_ff_id uuid;
  v_br_no text;
  v_ff_no text;
  v_total numeric;
BEGIN
  SELECT feed_name INTO v_feed_name FROM public.brooding_feed_inventory WHERE id = NEW.feed_id;
  v_total := COALESCE(NEW.total_cost, COALESCE(NEW.quantity_kg,0) * COALESCE(NEW.unit_cost,0));

  IF NEW.movement_type = 'purchase' THEN
    v_ref := next_feed_transfer_ref();
    v_br_no := next_brooding_movement_no();
    v_ff_no := next_feed_factory_movement_no();
    v_br_id := gen_random_uuid();
    v_ff_id := gen_random_uuid();

    INSERT INTO public.brooding_movements (
      id, movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      from_party, to_party, created_by,
      source_table, source_id, reference_no, linked_movement_id, notes
    ) VALUES (
      v_br_id, v_br_no, 'feed_receive', 'IN',
      'استلام علف — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      'مصنع الأعلاف', 'مخزون علف التحضين', NEW.created_by,
      'brooding_feed_stock_movements', NEW.id, v_ref, v_ff_id, NEW.notes
    );

    INSERT INTO public.feed_factory_movements (
      id, movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      from_party, to_party, created_by,
      source_table, source_id, reference_no, linked_movement_id, notes
    ) VALUES (
      v_ff_id, v_ff_no, 'brooding_supply', 'OUT',
      'توريد علف إلى التحضين — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      'مصنع الأعلاف', 'التحضين والتسمين', NEW.created_by,
      'brooding_feed_stock_movements', NEW.id, v_ref, v_br_id, NEW.notes
    );
  ELSIF NEW.movement_type = 'opening' THEN
    INSERT INTO public.brooding_movements (
      movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      created_by, source_table, source_id, notes
    ) VALUES (
      next_brooding_movement_no(), 'opening', 'IN',
      'رصيد افتتاحي — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      NEW.created_by, 'brooding_feed_stock_movements', NEW.id, NEW.notes
    );
  ELSIF NEW.movement_type = 'adjustment' THEN
    INSERT INTO public.brooding_movements (
      movement_no, movement_type, direction, item_name,
      quantity, unit, unit_cost, total_cost,
      created_by, source_table, source_id, notes
    ) VALUES (
      next_brooding_movement_no(), 'adjustment',
      CASE WHEN COALESCE(NEW.quantity_kg,0) >= 0 THEN 'IN' ELSE 'OUT' END,
      'تسوية مخزون — ' || COALESCE(v_feed_name,''),
      COALESCE(NEW.quantity_kg,0), 'كجم',
      COALESCE(NEW.unit_cost,0), v_total,
      NEW.created_by, 'brooding_feed_stock_movements', NEW.id, NEW.notes
    );
  END IF;

  RETURN NEW;
END $$;
