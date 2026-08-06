CREATE OR REPLACE FUNCTION public.canonical_wh_item_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := btrim(public.normalize_ar_name(coalesce(p_name,'')));
  v_key := btrim(regexp_replace(v_key, '(^| )(نعام|نعامه)( |$)', ' ', 'g'));
  v_key := btrim(regexp_replace(v_key, '\s+', ' ', 'g'));
  RETURN CASE
    WHEN v_key IN ('لحمه','لحم','لحم قطع','لحمه قطع','قطع لحم','لحم مقطع') THEN 'لحم قطع'
    WHEN v_key IN ('موزه','موزه لحم') THEN 'موزه'
    WHEN v_key IN ('فراشه') THEN 'فراشه'
    WHEN v_key IN ('استيك','ستيك') THEN 'استيك'
    WHEN v_key IN ('رقاب','رقبه') THEN 'رقاب'
    WHEN v_key IN ('نخاع') THEN 'نخاع'
    WHEN v_key IN ('كوارع','كوارع لحم') THEN 'كوارع'
    WHEN v_key IN ('كبده','كبد') THEN 'كبده'
    WHEN v_key IN ('قوانص','قانصه') THEN 'قوانص'
    WHEN v_key IN ('قلب','قلوب') THEN 'قلب'
    WHEN v_key IN ('كفته رز','كفته الرز') THEN 'كفته الرز'
    WHEN v_key IN ('كباب','كباب قطع') THEN 'قطع كباب'
    ELSE v_key
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_wh_item_by_name(p_warehouse_id uuid, p_name text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT i.id
  FROM public.inventory_items i
  LEFT JOIN public.products p ON p.id = i.product_id
  WHERE i.warehouse_id = p_warehouse_id
    AND (
      public.canonical_wh_item_name(i.name) = public.canonical_wh_item_name(p_name)
      OR public.canonical_wh_item_name(p.name) = public.canonical_wh_item_name(p_name)
    )
  ORDER BY (COALESCE(i.is_active, true)) DESC,
           (i.product_id IS NOT NULL) DESC,
           COALESCE(i.stock,0) DESC
  LIMIT 1
$$;