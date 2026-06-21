UPDATE public.meat_factory_raw_materials
SET default_unit = 'طبق'
WHERE name_ar ~* '(طبق|اطباق|أطباق)' AND default_unit ~* '(كيلو|كجم|kg)';

UPDATE public.meat_factory_raw_materials
SET default_unit = 'قطعة'
WHERE name_ar ~* '(اكياس|أكياس|كيس|استيكر|فويل|كرتون|سودا)' AND default_unit ~* '(كيلو|كجم|kg)';

UPDATE public.meat_factory_raw_items
SET unit = 'طبق'
WHERE name ~* '(طبق|اطباق|أطباق)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.meat_factory_raw_items
SET unit = 'قطعة'
WHERE name ~* '(اكياس|أكياس|كيس|استيكر|فويل|كرتون|سودا)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.packaging_materials
SET unit = 'طبق'
WHERE name_ar ~* '(طبق|اطباق|أطباق)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.packaging_materials
SET unit = 'قطعة'
WHERE name_ar ~* '(اكياس|أكياس|كيس|استيكر|فويل|كرتون|سودا)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.meat_raw_inventory
SET unit = 'طبق'
WHERE name_ar ~* '(طبق|اطباق|أطباق)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.meat_packaging_inventory
SET unit = 'طبق'
WHERE name_ar ~* '(طبق|اطباق|أطباق)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.meat_packaging_inventory
SET unit = 'قطعة'
WHERE name_ar ~* '(اكياس|أكياس|كيس|استيكر|فويل|كرتون|سودا)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.inventory_items
SET unit = 'طبق'
WHERE name ~* '(طبق|اطباق|أطباق)' AND unit ~* '(كيلو|كجم|kg)';

UPDATE public.inventory_items
SET unit = 'قطعة'
WHERE name ~* '(اكياس|أكياس|كيس|استيكر|فويل|كرتون|سودا)' AND unit ~* '(كيلو|كجم|kg)';