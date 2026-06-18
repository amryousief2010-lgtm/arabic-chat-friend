-- Merge duplicate meat factory raw items.
-- For each pair, the row WITH a code (or with real data) is the keeper;
-- all references on the duplicate are re-pointed to the keeper, then the duplicate row is removed.
-- No movements, invoices, recipes, or quantities are deleted — only the duplicate item record itself.

DO $$
DECLARE
  pairs JSONB := '[
    {"dup":"57fdca05-29ce-41a8-b5dd-bb6cbcbf1eb6","keep":"d8001a83-e386-49d5-a069-356366f0dfd0","name":"بقسماط"},
    {"dup":"bc58a5af-99ed-4eeb-8ac0-dc29bdf77818","keep":"2d86dfae-7b64-4054-9032-b42cf28925d5","name":"جوز الطيب"},
    {"dup":"18067081-f5f2-4a87-bc4a-4a33900fac96","keep":"3ed30f1b-3eea-469b-925a-10b0b0cef521","name":"دهن نعام"},
    {"dup":"0ceb3a59-a1f5-4007-a50f-1067361310ff","keep":"906beef5-a167-41e3-b344-138b135ddfdc","name":"ديمي جلاس"},
    {"dup":"d6930fef-586d-4c15-b118-79b34f07fca8","keep":"937d0fa6-0073-4a31-b50c-9a14c92d0269","name":"شغت"},
    {"dup":"32267405-694f-47c9-8edb-c3b51271b02e","keep":"84e932f0-0771-4db7-9577-b0327388f192","name":"شغت بقري"},
    {"dup":"401b024e-6bcb-4339-931d-48cc7ed67270","keep":"4c1bc84f-21e4-473f-9443-3c7e53d281a7","name":"كزبره ناشفه"},
    {"dup":"f2d99380-87e6-4fdd-9d6b-1031bb8f3e74","keep":"31b23f63-7eb4-4c93-88ae-27f62ad15fcf","name":"لحم نعام فرم"},
    {"dup":"90b9828d-025d-4cbb-98bd-7aaaa073996f","keep":"a7aada7b-93c7-465a-a132-4e069bf68ceb","name":"ملح"},
    {"dup":"d2c223d8-5a94-4b03-a8e4-76a835e67458","keep":"2a45dea2-3880-4760-b77d-195bb664aadb","name":"نشا"}
  ]'::jsonb;
  p JSONB;
  v_dup UUID;
  v_keep UUID;
BEGIN
  FOR p IN SELECT * FROM jsonb_array_elements(pairs) LOOP
    v_dup  := (p->>'dup')::uuid;
    v_keep := (p->>'keep')::uuid;

    -- Re-point all references
    UPDATE public.meat_factory_purchase_lines      SET raw_item_id        = v_keep WHERE raw_item_id        = v_dup;
    UPDATE public.meat_factory_manufacturing_lines SET raw_item_id        = v_keep WHERE raw_item_id        = v_dup;
    UPDATE public.meat_manufacturing_invoice_lines SET item_id            = v_keep WHERE item_id            = v_dup;
    UPDATE public.meat_recipe_item_mappings        SET mapped_raw_item_id = v_keep WHERE mapped_raw_item_id = v_dup;
    UPDATE public.meat_factory_inventory_moves     SET item_id            = v_keep WHERE item_id            = v_dup;
    UPDATE public.meat_factory_stocktaking_lines   SET item_id            = v_keep WHERE item_id            = v_dup;

    -- Drop the duplicate row (no movements/invoices are deleted — they now belong to the keeper).
    DELETE FROM public.meat_factory_raw_items WHERE id = v_dup;
  END LOOP;
END$$;