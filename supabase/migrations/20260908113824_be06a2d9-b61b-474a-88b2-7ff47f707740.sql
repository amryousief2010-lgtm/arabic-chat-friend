CREATE OR REPLACE FUNCTION public.request_production_for_order_shortages(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order record;
  v_item record;
  v_inv record;
  v_avail numeric;
  v_short numeric;
  v_created int := 0;
  v_creator_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, order_number, source_warehouse_id, shipping_company INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF v_order.source_warehouse_id IS NULL THEN RAISE EXCEPTION 'source_warehouse_unresolved'; END IF;

  SELECT full_name INTO v_creator_name FROM public.profiles WHERE id = v_uid;

  FOR v_item IN
    SELECT oi.id AS oi_id, oi.product_id, oi.product_name, p.unit AS unit, oi.quantity::numeric AS qty
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    WHERE oi.order_id = p_order_id
  LOOP
    IF v_item.product_id IS NULL THEN CONTINUE; END IF;
    SELECT id, stock, reserved_qty, blocked_qty INTO v_inv
      FROM public.inventory_items
     WHERE product_id = v_item.product_id AND warehouse_id = v_order.source_warehouse_id;
    v_avail := COALESCE(v_inv.stock,0) - COALESCE(v_inv.reserved_qty,0) - COALESCE(v_inv.blocked_qty,0);
    v_short := v_item.qty - v_avail;
    IF v_short > 0 THEN
      INSERT INTO public.production_dispatch_orders(
        product_id, product_name, unit, required_qty, current_stock,
        pending_qty, destination, priority, status, affected_orders,
        notes, created_by, created_by_name
      ) VALUES (
        v_item.product_id, v_item.product_name, v_item.unit, v_short, v_avail,
        v_short, COALESCE(v_order.shipping_company,'order'), 'high', 'pending',
        jsonb_build_array(jsonb_build_object('order_id',p_order_id,'order_number',v_order.order_number,'order_item_id',v_item.oi_id,'qty',v_item.qty)),
        'تلقائى من أوردر ' || v_order.order_number, v_uid, v_creator_name
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'order_id',p_order_id,'shortage_lines',v_created);
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_order_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_label text;
  v_labels constant jsonb := '{
    "pending":"قيد الانتظار",
    "processing":"قيد التجهيز",
    "ready":"جاهز للتسليم",
    "shipped":"تم الشحن",
    "delivered":"تم التوصيل",
    "returned":"مرتجع",
    "cancelled":"ملغي"
  }'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.notifications(title, description, type, order_id)
    values ('🆕 طلب جديد',
            'تم تسجيل الطلب ' || coalesce(new.order_number,'') || ' بقيمة ' || coalesce(new.total,0)::text || ' ج.م',
            'new_order', new.id);
    return new;
  end if;

  if new.status is distinct from old.status then
    v_label := coalesce(v_labels ->> new.status, new.status);

    -- single notification per status change: managers see it through the
    -- shared policy, the order creator through the order_id policy.
    insert into public.notifications(title, description, type, order_id)
    values ('📦 تحديث حالة الطلب',
            'الطلب ' || coalesce(new.order_number,'') || ' أصبح: ' || v_label,
            'status_update', new.id);
  end if;

  return new;
end;
$function$;