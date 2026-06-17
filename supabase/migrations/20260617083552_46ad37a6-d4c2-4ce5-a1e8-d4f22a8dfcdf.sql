
-- Add sale_price to feed raw materials (if missing) and update the 3 items
ALTER TABLE public.feed_raw_materials
  ADD COLUMN IF NOT EXISTS sale_price numeric(12,2);

-- Update sale prices for the requested items
UPDATE public.feed_raw_materials SET sale_price = 15  WHERE id = 'f9b7c746-62ce-460b-8049-192014d323c4';
UPDATE public.feed_raw_materials SET sale_price = 135 WHERE id = 'b57cea60-5fdd-4bca-bad7-b0784eacc6cd';
UPDATE public.feed_raw_materials SET sale_price = 125 WHERE id = '735ee292-253e-464b-a8d7-9a40365d8267';

-- Audit log entries
INSERT INTO public.feed_audit_log (table_name, row_id, action, old_value, new_value, performed_by, notes)
VALUES
  ('feed_raw_materials','f9b7c746-62ce-460b-8049-192014d323c4','update_sale_price',
    jsonb_build_object('name','دريس حجازي','sale_price',null),
    jsonb_build_object('name','دريس حجازي','sale_price',15),
    auth.uid(), 'تحديث سعر بيع صنف مصنع العلف'),
  ('feed_raw_materials','b57cea60-5fdd-4bca-bad7-b0784eacc6cd','update_sale_price',
    jsonb_build_object('name','بريمكس تسمين','sale_price',null),
    jsonb_build_object('name','بريمكس تسمين','sale_price',135),
    auth.uid(), 'تحديث سعر بيع صنف مصنع العلف'),
  ('feed_raw_materials','735ee292-253e-464b-a8d7-9a40365d8267','update_sale_price',
    jsonb_build_object('name','بريمكس بياض','sale_price',null),
    jsonb_build_object('name','بريمكس بياض','sale_price',125),
    auth.uid(), 'تحديث سعر بيع صنف مصنع العلف');
