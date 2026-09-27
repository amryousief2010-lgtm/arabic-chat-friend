-- One transaction: post through the ledger, then a direct stock write must be rejected.
-- The posting flags must not stay on after the function returns.
BEGIN;

DO $$
DECLARE
  v_wh uuid := gen_random_uuid();
  v_gm uuid := gen_random_uuid();
  v_prod uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_src uuid := gen_random_uuid();
  v_feed uuid := gen_random_uuid();
  v_raw uuid := gen_random_uuid();
  v_res jsonb;
  v_stock numeric;
BEGIN
  INSERT INTO auth.users (id, email, aud, role)
  VALUES (v_gm, 'flag-gm-' || v_gm::text || '@test.local', 'authenticated', 'authenticated');
  INSERT INTO public.user_roles (user_id, role) VALUES (v_gm, 'general_manager');
  INSERT INTO public.warehouses (id, name)
  VALUES (v_wh, 'مخزن إطفاء العلم ' || left(v_wh::text, 8));
  INSERT INTO public.products (id, name, price, barcode, is_active)
  VALUES (v_prod, 'صنف إطفاء العلم', 10, 'FG' || left(v_prod::text, 8), true);
  INSERT INTO public.inventory_items (id, warehouse_id, product_id, name, unit, stock)
  VALUES (v_item, v_wh, v_prod, 'بطاقة إطفاء العلم', 'كجم', 0);

  PERFORM set_config('request.jwt.claim.sub', v_gm::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('app.inventory_stock_write', 'off', true);
  PERFORM set_config('app.inventory_ledger_posted', 'off', true);

  v_res := public.post_inventory_movement(
    v_item, 'in', 10, 'manual_in', v_src, '1',
    'ترحيل ثم كتابة مباشرة', NULL, now(), 4, NULL, 'FLAG', 'delta', false,
    v_wh, v_prod, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'post failed %', v_res;
  END IF;
  IF current_setting('app.inventory_stock_write', true) = 'on'
     OR current_setting('app.inventory_ledger_posted', true) = 'on' THEN
    RAISE EXCEPTION 'flags stayed on stock_write=% ledger_posted=%',
      current_setting('app.inventory_stock_write', true),
      current_setting('app.inventory_ledger_posted', true);
  END IF;

  BEGIN
    UPDATE public.inventory_items SET stock = stock + 1 WHERE id = v_item;
    RAISE EXCEPTION 'direct stock write after post was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%direct stock write after post was allowed%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%مباشرة%' AND SQLERRM NOT LIKE '%حركات المخزون%' THEN
      RAISE;
    END IF;
  END;

  SELECT stock INTO v_stock FROM public.inventory_items WHERE id = v_item;
  IF v_stock IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'direct write changed stock to %', v_stock;
  END IF;

  INSERT INTO public.feed_raw_materials (id, name, stock) VALUES (v_feed, 'علف إطفاء العلم', 0);
  v_res := public.post_named_stock(
    'feed_raw_materials', v_feed, 4, 'purchase', v_feed, '1', 'شراء', NULL, 'delta', NULL
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'named post %', v_res;
  END IF;
  IF current_setting('app.named_stock_write', true) = 'on' THEN
    RAISE EXCEPTION 'named_stock_write stayed on';
  END IF;
  BEGIN
    UPDATE public.feed_raw_materials SET stock = 99 WHERE id = v_feed;
    RAISE EXCEPTION 'direct named write after post was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%direct named write after post was allowed%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%NAMED_STOCK_DIRECT_WRITE%' THEN
      RAISE;
    END IF;
  END;
  SELECT stock INTO v_stock FROM public.feed_raw_materials WHERE id = v_feed;
  IF v_stock IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'named direct write changed stock to %', v_stock;
  END IF;

  INSERT INTO public.meat_factory_raw_items (id, name) VALUES (v_raw, 'خام إطفاء العلم');
  v_res := public.post_meat_raw_movement(
    v_raw, 'IN', 3, 1, 'افتتاح إطفاء العلم', 'opening_balance_card', gen_random_uuid(),
    'raw', 'delta', NULL, NULL, 'خام إطفاء العلم'
  );
  IF v_res->>'status' IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'meat raw post %', v_res;
  END IF;
  IF current_setting('app.meat_raw_stock_write', true) = 'on' THEN
    RAISE EXCEPTION 'meat_raw_stock_write stayed on';
  END IF;
  BEGIN
    UPDATE public.meat_factory_raw_items SET current_stock = 99 WHERE id = v_raw;
    RAISE EXCEPTION 'direct meat raw write after post was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%direct meat raw write after post was allowed%' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%post_meat_raw_movement%' THEN
      RAISE;
    END IF;
  END;
  SELECT current_stock INTO v_stock FROM public.meat_factory_raw_items WHERE id = v_raw;
  IF v_stock IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'meat raw direct write changed stock to %', v_stock;
  END IF;

  RAISE NOTICE 'FLAG_RESET_OK';
END $$;

ROLLBACK;
