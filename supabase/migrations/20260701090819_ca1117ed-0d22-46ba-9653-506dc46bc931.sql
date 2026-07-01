CREATE OR REPLACE FUNCTION public.apply_slaughter_output_price_update(
  p_output_id uuid,
  p_manual_cost_per_kg numeric,
  p_manual_sale_price_per_kg numeric,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row slaughter_batch_outputs%ROWTYPE;
BEGIN
  IF NOT has_any_role(v_uid, ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'slaughterhouse_manager'::app_role]) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تعديل تكلفة أو سعر بيع مخرجات الدبح';
  END IF;

  SELECT * INTO v_row FROM slaughter_batch_outputs WHERE id = p_output_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'مخرج الدبح غير موجود'; END IF;

  IF p_manual_cost_per_kg IS DISTINCT FROM v_row.manual_cost_per_kg THEN
    INSERT INTO slaughter_output_price_audit(output_id, batch_id, product_id, field, old_value, new_value, reason, changed_by)
    VALUES (v_row.id, v_row.batch_id, v_row.product_id, 'cost_per_kg',
            COALESCE(v_row.manual_cost_per_kg, v_row.auto_cost_per_kg),
            p_manual_cost_per_kg, p_reason, v_uid);
  END IF;

  IF p_manual_sale_price_per_kg IS DISTINCT FROM v_row.manual_sale_price_per_kg THEN
    INSERT INTO slaughter_output_price_audit(output_id, batch_id, product_id, field, old_value, new_value, reason, changed_by)
    VALUES (v_row.id, v_row.batch_id, v_row.product_id, 'sale_price_per_kg',
            COALESCE(v_row.manual_sale_price_per_kg, v_row.suggested_sale_price_per_kg),
            p_manual_sale_price_per_kg, p_reason, v_uid);
  END IF;

  UPDATE slaughter_batch_outputs
     SET manual_cost_per_kg = p_manual_cost_per_kg,
         manual_sale_price_per_kg = p_manual_sale_price_per_kg,
         price_edit_reason = p_reason,
         price_updated_by = v_uid,
         price_updated_at = now()
   WHERE id = p_output_id;
END;
$function$;