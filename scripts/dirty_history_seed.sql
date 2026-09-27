-- Dirty live-shaped history, loaded AFTER migrations 1-6 and BEFORE 7-20.
-- Triggers are off so these inserts do not move stock. Nothing here is deleted later.
SET session_replication_role = replica;

DO $$
DECLARE
  v_wh uuid := '11111111-1111-4111-8111-111111111111';
  v_item uuid := '22222222-2222-4222-8222-222222222222';
  v_prod uuid := '33333333-3333-4333-8333-333333333333';
  v_order uuid := '44444444-4444-4444-8444-444444444444';
  v_line1 uuid := '55555555-5555-4555-8555-555555555551';
  v_line2 uuid := '55555555-5555-4555-8555-555555555552';
  v_may uuid := '66666666-6666-4666-8666-666666666666';
  v_open_item uuid := '77777777-7777-4777-8777-777777777777';
  v_batch uuid := '88888888-8888-4888-8888-888888888888';
  v_out uuid := '99999999-9999-4999-8999-999999999999';
  v_raw uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_custody uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
  v_cret uuid := 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
  i int;
  v_feed uuid;
BEGIN
  INSERT INTO public.warehouses (id, name) VALUES (v_wh, 'مخزن تاريخ متسخ')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.products (id, name, price, is_active, barcode)
  VALUES (v_prod, 'منتج سطرين', 10, true, 'BC-DIRTY')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.inventory_items (id, warehouse_id, name, unit, stock, product_id)
  VALUES (v_item, v_wh, 'بطاقة سطرين', 'كجم', 40, v_prod),
         (v_open_item, v_wh, 'بطاقة افتتاح', 'كجم', 8, NULL);

  INSERT INTO public.orders (id, order_number, status, source_warehouse_id, stock_status)
  VALUES (v_order, 'ORD-LINES', 'delivered', v_wh, 'dispatched'),
         (v_may, 'ORD-20260527-863378', 'delivered', v_wh, 'dispatched');
  INSERT INTO public.order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
  VALUES (v_line1, v_order, v_prod, 'منتج سطرين', 2, 10, 20),
         (v_line2, v_order, v_prod, 'منتج سطرين', 3, 10, 30);

  INSERT INTO public.inventory_movements (
    item_id, warehouse_id, movement_type, quantity, reference_type, reference_id,
    order_item_id, approval_status, performed_at, created_at
  ) VALUES
    (v_item, v_wh, 'sales_dispatch', 2, 'order', v_order::text, v_line1, 'posted',
     timestamptz '2026-05-01', timestamptz '2026-05-01'),
    (v_item, v_wh, 'sales_dispatch', 3, 'order', v_order::text, v_line2, 'posted',
     timestamptz '2026-05-01', timestamptz '2026-05-01'),
    (v_item, v_wh, 'sales_dispatch', -1, 'order', v_may::text, NULL, 'posted',
     timestamptz '2026-05-27', timestamptz '2026-05-27'),
    (v_item, v_wh, 'sales_dispatch', -0.5, 'order', v_may::text, NULL, 'posted',
     timestamptz '2026-05-27', timestamptz '2026-05-27');

  INSERT INTO public.inventory_movements (
    item_id, warehouse_id, movement_type, quantity, performed_at, created_at, notes
  ) VALUES
    (v_open_item, v_wh, 'opening_balance', 8, timestamptz '2026-06-02', timestamptz '2026-06-02', 'افتتاح 2 يونيو'),
    (v_open_item, v_wh, 'opening_balance', 8, timestamptz '2026-06-18', timestamptz '2026-06-18', 'افتتاح 18 يونيو');

  INSERT INTO public.meat_factory_raw_items (id, name, unit, current_stock, kind)
  VALUES (v_raw, 'خام تاريخ', 'كجم', 0, 'raw');
  INSERT INTO public.meat_factory_inventory_moves (
    item_kind, item_id, item_name, direction, quantity, reason, ref_table, ref_id, created_at
  ) VALUES
    ('raw', v_raw, 'خام تاريخ', 'IN', 1, 'تاريخ', 'mf_dup', v_raw, timestamptz '2026-05-01'),
    ('raw', v_raw, 'خام تاريخ', 'IN', 1, 'تاريخ مكرر', 'mf_dup', v_raw, timestamptz '2026-05-02');

  INSERT INTO public.slaughter_batches (id, batch_number) VALUES (v_batch, 'HIST-RECV');
  INSERT INTO public.slaughter_batch_outputs (
    id, batch_id, cut_name_ar, actual_weight_kg, destination, quality_status, received_status
  ) VALUES (
    v_out, v_batch, 'قطعية مستلمة بلا حركة', 4, 'warehouse', 'accepted', 'received'
  );

  FOR i IN 1..6 LOOP
    v_feed := ('dddddddd-dddd-4ddd-8ddd-ddddddddddd' || i::text)::uuid;
    INSERT INTO public.feed_raw_materials (id, name, stock)
    VALUES (v_feed, 'علف سالب ' || i::text, -51);
  END LOOP;

  INSERT INTO public.orders (id, order_number, status) VALUES (v_cret, 'ORD-CRET', 'delivered');
  INSERT INTO public.courier_goods_custodies (id, courier_name) VALUES (v_custody, 'مندوب تاريخ');
  INSERT INTO public.courier_goods_custody_lines (
    custody_id, line_type, order_id, inventory_item_id, product_name, quantity, created_at
  ) VALUES
    (v_custody, 'return', v_cret, v_item, 'بطاقة سطرين', 1, timestamptz '2026-05-01'),
    (v_custody, 'return', v_cret, v_item, 'بطاقة سطرين', 1, timestamptz '2026-05-02');
END $$;

SET session_replication_role = DEFAULT;

DROP TABLE IF EXISTS public.dirty_history_stock;
CREATE TABLE public.dirty_history_stock AS
SELECT 'inventory_items'::text AS store,
       count(*)::bigint AS n,
       round(COALESCE(sum(stock), 0), 3) AS qty
  FROM public.inventory_items
UNION ALL
SELECT 'feed_raw_materials', count(*)::bigint, round(COALESCE(sum(stock), 0), 3)
  FROM public.feed_raw_materials
UNION ALL
SELECT 'sales_dispatch_rows', count(*)::bigint, round(COALESCE(sum(quantity), 0), 3)
  FROM public.inventory_movements
 WHERE movement_type = 'sales_dispatch'
UNION ALL
SELECT 'opening_rows', count(*)::bigint, round(COALESCE(sum(quantity), 0), 3)
  FROM public.inventory_movements
 WHERE movement_type = 'opening_balance';
