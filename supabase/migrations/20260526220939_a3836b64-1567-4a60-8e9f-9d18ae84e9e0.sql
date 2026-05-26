
UPDATE inventory_items SET stock = CASE p.name
  WHEN 'لحم قطع' THEN 23
  WHEN 'استيك' THEN 37
  WHEN 'موزة' THEN 23
  WHEN 'فراشة' THEN 7
  WHEN 'قطعية الدبوس' THEN 3.5
  WHEN 'رول' THEN 6
  WHEN 'تربيانكو' THEN 10.5
  WHEN 'اسكالوب' THEN 7
  WHEN 'قوانص' THEN 12.5
  WHEN 'قلب' THEN 11
  WHEN 'كبدة' THEN 10.5
  WHEN 'رقاب' THEN 24
  WHEN '6ك دبوس بالعظم' THEN 42
  WHEN 'كفتة' THEN 21.5
  WHEN 'برجر' THEN 17
  WHEN 'سجق' THEN 11
  WHEN 'حواوشي' THEN 8.5
  WHEN 'مفروم' THEN 32
  WHEN 'شيش' THEN 6.5
  WHEN 'شاورما' THEN 11.5
  WHEN 'طرب' THEN 4.5
  WHEN 'قطع كباب' THEN 4
  WHEN 'كوارع' THEN 5
  WHEN 'ممبار' THEN 0
  WHEN 'كفتة الرز' THEN 25
  ELSE inventory_items.stock
END
FROM products p
WHERE inventory_items.product_id = p.id
  AND inventory_items.warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e'
  AND p.name IN ('لحم قطع','استيك','موزة','فراشة','قطعية الدبوس','رول','تربيانكو','اسكالوب','قوانص','قلب','كبدة','رقاب','6ك دبوس بالعظم','كفتة','برجر','سجق','حواوشي','مفروم','شيش','شاورما','طرب','قطع كباب','كوارع','ممبار','كفتة الرز');
