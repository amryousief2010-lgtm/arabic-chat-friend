CREATE TABLE IF NOT EXISTS public.inventory_item_merge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_ref text NOT NULL,
  canonical_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  source_item_id uuid NOT NULL REFERENCES public.inventory_items(id),
  source_name text,
  canonical_name text,
  source_stock_before numeric NOT NULL DEFAULT 0,
  canonical_stock_before numeric NOT NULL DEFAULT 0,
  canonical_stock_after numeric NOT NULL DEFAULT 0,
  moved_movements integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.inventory_item_merge_log TO authenticated;
GRANT ALL ON public.inventory_item_merge_log TO service_role;
ALTER TABLE public.inventory_item_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "merge log readable by managers" ON public.inventory_item_merge_log;
CREATE POLICY "merge log readable by managers" ON public.inventory_item_merge_log
FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'warehouse_supervisor') OR public.has_role(auth.uid(),'accountant')
);

CREATE TEMP TABLE _merge_pairs(source_id uuid, canonical_id uuid, source_name text, source_stock numeric, mv int) ON COMMIT DROP;
INSERT INTO _merge_pairs VALUES
('f8e56014-8442-45a5-953b-2b8fc13b03bf','1b506655-e6b7-4bcf-98b8-86322b1681d2','كفتة',3.0,0),('7aa046e6-7398-4f95-af0c-f679d5c27696','1b506655-e6b7-4bcf-98b8-86322b1681d2','كفتة نعام',95.0,2),('64f23d01-e1de-4b99-83f7-4ce178f8d7f1','1b506655-e6b7-4bcf-98b8-86322b1681d2','كفته نعام',27.25,2),('10d5a862-dc2d-415d-84a5-64ba206f29e5','b05c7338-2c13-4933-93fe-016bb2b5eb33','رقاب نعام',52.0,2),('fc305663-7af9-49cd-b5bd-f5fe6777e389','b05c7338-2c13-4933-93fe-016bb2b5eb33','رقاب نعام',21.2,2),('8e24dcf1-8f3d-4c5f-9fc5-be50f8bd5ea3','58a10a0a-f083-4ba3-8c0b-a993df02b7fa','برجر نعام',26.5,3),('fff9711e-52e2-4c3f-aeac-cec38a9553b0','58a10a0a-f083-4ba3-8c0b-a993df02b7fa','برجر نعام',123.5,2),('a6ca6c76-73eb-4e44-8018-e7f37a57a6d6','3ad41961-3bad-495e-9e26-622c6f0514a0','شغت نعام',32.0,2),('4a8e8b34-be5a-462b-923c-78a59f4183cb','3ad41961-3bad-495e-9e26-622c6f0514a0','شغت',40.7,15),('c57af7b5-94b4-4290-ba1c-de5f564e657a','3ad41961-3bad-495e-9e26-622c6f0514a0','شغت',0.0,2),('0e25697e-abe8-4887-a80c-14cfc6babece','865f5eee-57b6-4d29-a76b-0a130563dc10','حواوشي نعام',22.0,3),('c1ca1cca-9ad6-4868-b51c-5b581dcc8ae0','865f5eee-57b6-4d29-a76b-0a130563dc10','حواوشي نعام',54.0,2),('8c304eb4-286a-43db-9d2e-ff6bde3e17d7','aff825de-e3ad-470c-84a0-adef23cf9886','نخاع نعام',19.5,3),('8c35e045-b95e-4131-ae63-47c3a0584037','aff825de-e3ad-470c-84a0-adef23cf9886','نخاع',59.0,10),('24d1af89-dfe3-403b-86e0-5aa62e8fb0ac','aff825de-e3ad-470c-84a0-adef23cf9886','نخاع',3.0,2),('81cc59c8-9c76-4f01-b2cd-f6b2bd51c422','77fe331e-b2d1-4164-a135-87385f2ef508','سجق نعام',32.0,3),('0f98ca93-bc23-4c8e-9e4f-1111526b803a','77fe331e-b2d1-4164-a135-87385f2ef508','سجق نعام',25.0,2),('685b831e-54bd-4df9-85f8-18321d5db836','f7c05b23-8ffa-4899-8789-083da23b0e35','كبده',59.5,21),('1a8e6e29-d13d-4035-af6f-c8ac7c9e2752','f7c05b23-8ffa-4899-8789-083da23b0e35','كبده نعام',0.0,2),('f5dae69b-96b6-4ee8-bee9-3505c1bfa327','16c4531a-ecdd-46ca-a67c-0987ca88cd01','شاورما نعام',52.0,2),('b607151a-028b-4303-abf1-2c502aa6ae32','16c4531a-ecdd-46ca-a67c-0987ca88cd01','شاورما نعام',13.5,2),('c0e029d8-87d7-4874-8da7-9ed9230c8212','ad5d4ffa-7b0e-4e86-b63e-70d9fc80319e','كوارع نعام',22.0,2),('8e1c105c-212b-4193-b9c9-b614b08abbcd','ad5d4ffa-7b0e-4e86-b63e-70d9fc80319e','كوارع نعام',0.0,2),('890b12ce-5f47-4719-b9ff-3201c2ca73df','50c7a580-6ef0-4535-b74f-9be9b4c3df02','قلب نعام',21.0,2),('734a6551-723a-4db6-a11c-d07a207f917b','50c7a580-6ef0-4535-b74f-9be9b4c3df02','قلب نعام',18.0,2),('701308f2-cb35-4e67-9792-10e22007dfad','331ec86b-bace-4180-815d-de993ebcbd87','مفروم نعام',8.0,2),('f5d2476c-c069-4af4-91b3-1ad2555aa1ee','331ec86b-bace-4180-815d-de993ebcbd87','مفروم نعام',0.0,2),('6e03c101-8a28-4848-868b-87c8c79ca6b3','59a1fc40-755a-4089-b4ba-b33d3cd62149','قوانص نعام',13.0,2),('a6fa954e-e9a6-4917-8d39-6604a186839a','59a1fc40-755a-4089-b4ba-b33d3cd62149','قوانص نعام',9.9,2),('6bc2e57c-46a8-4a59-b002-33c95981d682','844afb79-a3f0-47fb-8b0f-99803c650c7e','موزة نعام',0.0,2),('004bbb23-9ac5-46f6-bd9c-c0831c1bde8a','844afb79-a3f0-47fb-8b0f-99803c650c7e','موزه',9.5,21),('95241a04-ecef-47eb-b258-fd910256896e','844afb79-a3f0-47fb-8b0f-99803c650c7e','موزه نعام',22.0,2),('7c0fb2c4-81ca-4d3a-a601-808a865a8599','36c5c706-6937-4d07-8d7b-33f2334db01e','فراشة نعام',9.0,2),('f0a2b355-9bf4-4536-afda-8eb560c36234','36c5c706-6937-4d07-8d7b-33f2334db01e','فراشه نعام',5.0,2),('88d134bf-5267-41ad-a542-eb9087b271fa','36c5c706-6937-4d07-8d7b-33f2334db01e','فراشه',11.5,7),('ea90a2b7-6aea-4b00-9a7c-b8bdf1cefa21','fa59bdf8-1f69-48c3-b9f4-5e86c15daaa5','طرب نعام',21.0,2),('1e58992c-d426-4f28-af02-d5282caee4ed','60ff94aa-e859-413a-b283-53e937836b64','تربيانكو نعام',25.0,2),('d38cb5d4-de73-4b85-80c3-cbd65e689970','9b1cc208-fef1-4e16-9046-7b5594ffbf76','شيش نعام',12.5,3),('0b9510e5-674f-4c93-9244-26e9e6bd3843','0e25ef2b-5537-40ae-a179-ed0d72646bca','كفتة الرز نعام',7.0,2),('925933ca-e53b-4ca5-8d46-4495b98a4379','6ee69bf0-0818-4d8e-89d1-d2a5e740a46f','بيض نعام',9.0,2),('69f07371-be2e-4f26-9dd4-12ca2a3b0f4d','7ecdcec7-db6f-42cf-bcc4-732da8e6382d','فرم نعام',7.5,5),('b5707d94-06b9-46cf-9536-fa68641c1165','7ecdcec7-db6f-42cf-bcc4-732da8e6382d','فرم نعام',0.0,2),('a9ba0de5-ee2b-4e89-9406-4aa2483eef4d','4c5f9c88-0f45-46b6-90fd-9edc11f13343','بان فلت',0.0,0),('21b35c5f-24a5-43ce-b016-8e07fd57de6f','b58b8d12-5ba7-4029-a0dd-994f0f982e2a','رول نعام',2.0,2),('2a00bd03-d4c1-4ca1-a99e-5c39ab55783a','cff8bf43-336f-4aa5-ba8a-2934294689a2','ممبار نعام',1.0,3);

CREATE TEMP TABLE _merge_can(canonical_id uuid, canonical_name text, unit text, total numeric, stock_before numeric) ON COMMIT DROP;
INSERT INTO _merge_can VALUES
('1b506655-e6b7-4bcf-98b8-86322b1681d2','كفتة','كجم',176.25,51.0),('b05c7338-2c13-4933-93fe-016bb2b5eb33','رقاب','كجم',170.2,97.0),('58a10a0a-f083-4ba3-8c0b-a993df02b7fa','برجر','كجم',150.0,0.0),('3ad41961-3bad-495e-9e26-622c6f0514a0','شغت نعام','كجم',129.2,56.5),('865f5eee-57b6-4d29-a76b-0a130563dc10','حواوشي','كجم',106.5,30.5),('aff825de-e3ad-470c-84a0-adef23cf9886','نخاع ','كجم',96.5,15.0),('77fe331e-b2d1-4164-a135-87385f2ef508','سجق','كجم',85.5,28.5),('f7c05b23-8ffa-4899-8789-083da23b0e35','كبدة','كجم',82.0,22.5),('16c4531a-ecdd-46ca-a67c-0987ca88cd01','شاورما','كجم',75.5,10.0),('ad5d4ffa-7b0e-4e86-b63e-70d9fc80319e','كوارع','كجم',68.0,46.0),('50c7a580-6ef0-4535-b74f-9be9b4c3df02','قلب','كجم',58.5,19.5),('331ec86b-bace-4180-815d-de993ebcbd87','مفروم','كجم',51.5,43.5),('59a1fc40-755a-4089-b4ba-b33d3cd62149','قوانص','كجم',37.9,15.0),('844afb79-a3f0-47fb-8b0f-99803c650c7e','موزة','كجم',32.5,1.0),('36c5c706-6937-4d07-8d7b-33f2334db01e','فراشة','كجم',30.5,5.0),('fa59bdf8-1f69-48c3-b9f4-5e86c15daaa5','طرب','كجم',29.0,8.0),('60ff94aa-e859-413a-b283-53e937836b64','تربيانكو','كجم',25.0,0.0),('9b1cc208-fef1-4e16-9046-7b5594ffbf76','شيش','كجم',25.0,12.5),('0e25ef2b-5537-40ae-a179-ed0d72646bca','كفتة الرز','كجم',25.0,18.0),('6ee69bf0-0818-4d8e-89d1-d2a5e740a46f','بيض ','كجم',9.0,0.0),('7ecdcec7-db6f-42cf-bcc4-732da8e6382d','فرم نعام','كجم',7.5,0.0),('4c5f9c88-0f45-46b6-90fd-9edc11f13343','بان فلت','كجم',6.5,6.5),('b58b8d12-5ba7-4029-a0dd-994f0f982e2a','رول','كجم',3.5,1.5),('cff8bf43-336f-4aa5-ba8a-2934294689a2','ممبار','كجم',2.0,1.0);

INSERT INTO public.inventory_item_merge_log(merge_ref,canonical_item_id,source_item_id,source_name,canonical_name,source_stock_before,canonical_stock_before,canonical_stock_after,moved_movements)
SELECT 'MAIN-NAME-UNIFY-20260802', p.canonical_id, p.source_id, p.source_name, c.canonical_name, p.source_stock, c.stock_before, c.total, p.mv
FROM _merge_pairs p JOIN _merge_can c ON c.canonical_id = p.canonical_id;

ALTER TABLE public.inventory_movements DISABLE TRIGGER trg_adjust_inventory_movement_upd;

UPDATE public.inventory_movements m SET item_id = p.canonical_id FROM _merge_pairs p WHERE m.item_id = p.source_id;
UPDATE public.stocktaking_lines s SET item_id = p.canonical_id FROM _merge_pairs p WHERE s.item_id = p.source_id;
UPDATE public.warehouse_transfer_items t SET source_item_id = p.canonical_id FROM _merge_pairs p WHERE t.source_item_id = p.source_id;
UPDATE public.warehouse_transfer_items t SET destination_item_id = p.canonical_id FROM _merge_pairs p WHERE t.destination_item_id = p.source_id;
UPDATE public.slaughter_batch_outputs o SET received_inventory_item_id = p.canonical_id FROM _merge_pairs p WHERE o.received_inventory_item_id = p.source_id;
UPDATE public.agouza_stock_reservations r SET inventory_item_id = p.canonical_id FROM _merge_pairs p WHERE r.inventory_item_id = p.source_id;

UPDATE public.inventory_items i
SET stock = c.total, name = c.canonical_name, unit = c.unit, is_active = true, updated_at = now()
FROM _merge_can c WHERE i.id = c.canonical_id;

UPDATE public.inventory_items i
SET stock = 0, is_active = false, updated_at = now(),
    notes = COALESCE(i.notes,'') || ' | مدمج في الكارت الموحّد (MAIN-NAME-UNIFY-20260802)'
FROM _merge_pairs p WHERE i.id = p.source_id;

ALTER TABLE public.inventory_movements ENABLE TRIGGER trg_adjust_inventory_movement_upd;