DELETE FROM public.farm_egg_production WHERE production_date BETWEEN '2026-01-01' AND '2026-01-31';

INSERT INTO public.farm_egg_production (production_date, family_id, egg_count)
SELECT
  d::date AS production_date,
  f.family_id,
  COALESCE(e.egg_count, 0) AS egg_count
FROM generate_series('2026-01-01'::date, '2026-01-31'::date, interval '1 day') AS d
CROSS JOIN (VALUES
  (1,'aeddfe18-002b-4d56-87d4-ef87cf3700a8'::uuid),
  (2,'1713aca9-aafa-41db-8bdb-0d47fd103c2f'::uuid),
  (3,'55583ba9-903b-4d6e-998f-d6769b7f3ddb'::uuid),
  (4,'9a4244cb-8ae2-402c-bfdb-66eccb4475d2'::uuid),
  (5,'a4469dbd-6310-4978-a98d-54f1297093f2'::uuid),
  (6,'f8e1b135-bd16-4ea9-ac8e-23ddd38da9e2'::uuid),
  (7,'cf65eee7-6d6f-42ad-bfd5-6670c0379b16'::uuid),
  (8,'66495e4b-4393-437f-bf65-c5d5862e7ea8'::uuid),
  (9,'bd3a1f7b-897c-42f2-ae07-1d674c1d9fdc'::uuid),
  (10,'9f59183e-f5a4-4820-a2dc-e7410b97df08'::uuid),
  (11,'5d5bb254-1a3d-4071-9d3f-64f9b71bf88d'::uuid),
  (12,'6697320a-4234-40fb-af72-8dcb739c4f45'::uuid),
  (13,'04c00668-7424-4cdb-aa71-800b8dbef2fa'::uuid),
  (14,'231f4ead-678d-422a-90a9-706dc6d898bd'::uuid),
  (15,'90472b25-f94f-4a70-9350-37d910f76e12'::uuid),
  (16,'597b79e4-4f54-4786-a5b5-1bab9c003417'::uuid),
  (17,'6f04a5cb-26bf-45f7-a1ee-a50bb80ae175'::uuid),
  (18,'8c43acbe-0a89-4eb4-af23-0f226b13c904'::uuid),
  (19,'b717876f-8f9e-4260-8089-51c6a6622a9b'::uuid),
  (20,'3175d5bc-9cf5-4f29-b876-332aaacfdbc9'::uuid)
) AS f(family_no, family_id)
LEFT JOIN (VALUES
  (1,2,2),(1,11,2),(1,18,1),(1,25,2),(1,31,1),
  (3,2,1),(3,11,2),(3,18,1),(3,31,1),
  (7,2,1),(7,11,1),(7,18,1),(7,25,1),(7,31,1),
  (8,2,2),(8,11,3),(8,18,3),(8,25,1),(8,31,2),
  (10,2,4),(10,11,5),(10,18,5),(10,25,6),(10,31,1),
  (11,2,5),(11,11,1),(11,31,5),
  (12,2,2),(12,11,2),(12,18,1),(12,25,2),(12,31,1),
  (13,2,1),(13,11,2),(13,18,2),(13,25,1),(13,31,2),
  (14,2,1),(14,11,2),(14,18,1),(14,25,2),(14,31,3),
  (15,2,1),(15,11,2),(15,18,2),(15,25,1),(15,31,1),
  (16,11,2),(16,18,2),(16,25,1),(16,31,1),
  (17,2,1),(17,11,3),(17,18,2),(17,25,3),(17,31,1),
  (18,11,2),(18,18,2),(18,31,2),
  (19,11,1),(19,18,1),(19,25,1),(19,31,1)
) AS e(family_no, day_no, egg_count)
  ON e.family_no = f.family_no AND e.day_no = EXTRACT(DAY FROM d)::int;