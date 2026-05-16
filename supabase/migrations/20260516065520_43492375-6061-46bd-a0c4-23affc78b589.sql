
-- Add official barcode column to products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_unique ON public.products(barcode) WHERE barcode IS NOT NULL;

-- Populate official GS1 barcodes for existing products
UPDATE public.products SET barcode = '6224003208018' WHERE id = '858b0aa9-6ef7-4e83-a77e-796a7308cc32'; -- استيك
UPDATE public.products SET barcode = '6224003208025' WHERE id = 'c1f7974f-a6d4-4cf8-b7c8-643241f7d0e6'; -- لحم قطع (Ostrich Meat)
UPDATE public.products SET barcode = '6224003208032' WHERE id = '2bcf341e-9675-4027-9822-a692f65db045'; -- موزة
UPDATE public.products SET barcode = '6224003208049' WHERE id = '3bd0f408-b7a8-49e9-8f75-5010b61f3eb7'; -- فراشة
UPDATE public.products SET barcode = '6224003208056' WHERE id = 'd2133a91-5225-4d21-8e03-c14d3a27d03e'; -- تربيانكو
UPDATE public.products SET barcode = '6224003208063' WHERE id = '39b3b407-fc1d-4523-b0d5-d7fdfc766624'; -- اسكالوب
UPDATE public.products SET barcode = '6224003208070' WHERE id = '44ce6861-1530-4825-a516-3606b2015c09'; -- قطعية الدبوس
UPDATE public.products SET barcode = '6224003208087' WHERE id = '7091ec51-de3e-493a-b0e2-da526399a1e8'; -- كبدة
UPDATE public.products SET barcode = '6224003208094' WHERE id = 'cad6d8a9-35e2-47b4-8f37-ccea66d50e4d'; -- قلب
UPDATE public.products SET barcode = '6224003208100' WHERE id = 'd0a0d82d-1bd9-402f-9ee3-d12bd7270ff7'; -- قوانص
UPDATE public.products SET barcode = '6224003208124' WHERE id = '69de7370-7ec6-4f68-acc6-88f7a520d4c0'; -- برجر
UPDATE public.products SET barcode = '6224003208131' WHERE id = '2374f5f8-5aa3-44d1-93af-8bde0b7942ca'; -- كفتة
UPDATE public.products SET barcode = '6224003208179' WHERE id = '42db45a6-a390-4781-abaf-9fceaf99932b'; -- حواوشي
UPDATE public.products SET barcode = '6224003208223' WHERE id = '07065f2a-ffb3-4084-9d85-4960dca8292e'; -- رقاب
UPDATE public.products SET barcode = '6224003208148' WHERE id = '399eab16-5ed7-4e87-8435-d4a459509fa1'; -- سجق
UPDATE public.products SET barcode = '6224003208162' WHERE id = '0ebdea65-9bcf-4672-8efb-448eb5cddb60'; -- رول
UPDATE public.products SET barcode = '6224003208155' WHERE id = 'c5da696b-33a4-4a5b-aa4e-7b8e73f2ea6b'; -- كفتة الرز
UPDATE public.products SET barcode = '6224003208230' WHERE id = '8eace4fc-1709-46c3-832e-769dc4326d74'; -- مفروم
UPDATE public.products SET barcode = '6224003208216' WHERE id = 'd810e02c-f734-4016-bc7a-ab0bb575c9d5'; -- كوارع
UPDATE public.products SET barcode = '6224003208254' WHERE id = '4c5b9dc9-31c7-41f8-b22d-84f655c96b2e'; -- قطع كباب
UPDATE public.products SET barcode = '6224003208247' WHERE id = '9bb5de6d-d9aa-4171-9fd4-241ec4824683'; -- شاورما
UPDATE public.products SET barcode = '6224003208261' WHERE id = '6dd494d4-d47e-4dcf-9af7-103450af4a9a'; -- شيش
UPDATE public.products SET barcode = '6224003208285' WHERE id = '5492d382-bcd7-454f-9fa8-6dfe2c8c8150'; -- طرب
UPDATE public.products SET barcode = '6224003208278' WHERE id = 'c6b2d3c4-56e1-486c-a975-f764352b6a67'; -- ممبار
UPDATE public.products SET barcode = '6224003208292' WHERE id = '405ece91-0ad3-4b51-afb0-da90dc69cbbe'; -- دبوس بالعظم 6 كيلو
UPDATE public.products SET barcode = '6224003208117' WHERE id = '41510db5-f594-41d7-8ac1-b7abb81be424'; -- نعامة صندوق (Slaughtering ostrich)
