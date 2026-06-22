-- Fix packaging item classification only (no quantity/price changes).
-- Reactivate packaging items that still have stock but were marked inactive.
UPDATE public.meat_factory_raw_items
   SET is_active = true, updated_at = now()
 WHERE id IN (
   'c1a54af2-6269-4c48-9f76-b7db72d13ce5',  -- أكياس بيضاء
   '67e18220-cd3f-45e7-b632-83e89de45690',  -- أكياس سمراء
   'df61be6c-57f9-412c-a1d9-60d28c2362fc'   -- أطباق فوم
 );

-- Reclassify items that are packaging but were filed as raw.
UPDATE public.meat_factory_raw_items
   SET kind = 'packaging', updated_at = now()
 WHERE id = 'c91a383c-0cfc-4167-8bec-e9e45341d99a';  -- اطباق سودا نص كيلو

UPDATE public.meat_factory_raw_items
   SET kind = 'packaging', unit = 'كيس', updated_at = now()
 WHERE id = '8c7bc26d-efee-4778-8898-b28af1319558';  -- اكياس سودا مقاس 20*30

INSERT INTO public.meat_factory_audit_log (table_name, row_id, action, new_value, performed_by) VALUES
  ('meat_factory_raw_items','c1a54af2-6269-4c48-9f76-b7db72d13ce5','reclassify',jsonb_build_object('is_active',true,'reason','reactivate packaging item with remaining stock'),NULL),
  ('meat_factory_raw_items','67e18220-cd3f-45e7-b632-83e89de45690','reclassify',jsonb_build_object('is_active',true,'reason','reactivate packaging item with remaining stock'),NULL),
  ('meat_factory_raw_items','df61be6c-57f9-412c-a1d9-60d28c2362fc','reclassify',jsonb_build_object('is_active',true,'reason','reactivate packaging item with remaining stock'),NULL),
  ('meat_factory_raw_items','c91a383c-0cfc-4167-8bec-e9e45341d99a','reclassify',jsonb_build_object('kind','packaging','reason','اطباق سودا نص كيلو تنتمي لمواد التغليف'),NULL),
  ('meat_factory_raw_items','8c7bc26d-efee-4778-8898-b28af1319558','reclassify',jsonb_build_object('kind','packaging','unit','كيس','reason','اكياس سودا 20x30 تنتمي لمواد التغليف وتُعد بالكيس'),NULL);