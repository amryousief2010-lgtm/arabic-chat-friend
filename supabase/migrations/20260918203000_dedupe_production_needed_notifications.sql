-- Dedupe manufacturing ("production_needed") notifications.
-- Root cause: trg_notify_production_needed fires AFTER INSERT on every
-- order_items row when qty > products.stock. Dedupe was only
-- (order_id + unread + description LIKE product name), so offer boxes and
-- multi-line orders created many unread alerts per order. Nothing marked
-- them read when the order was delivered/cancelled.

-- 1) Collapse existing unread duplicates: keep the newest row per order.
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY order_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM public.notifications
  WHERE type = 'production_needed'
    AND is_read = false
    AND order_id IS NOT NULL
)
UPDATE public.notifications n
SET is_read = true
FROM ranked r
WHERE n.id = r.id
  AND r.rn > 1;

-- 2) One unread manufacturing alert per order going forward.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_production_needed_unread_order_idx
  ON public.notifications (order_id)
  WHERE type = 'production_needed'
    AND is_read = false
    AND order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_production_needed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stock integer;
  v_name text;
  v_order_no text;
  v_existing uuid;
BEGIN
  IF NEW.product_id IS NULL THEN RETURN NEW; END IF;

  SELECT stock, name INTO v_stock, v_name
  FROM public.products WHERE id = NEW.product_id;

  IF v_stock IS NULL THEN RETURN NEW; END IF;

  -- Same rule as before: ordered qty (truncated) exceeds catalog stock.
  IF NEW.quantity::int > v_stock THEN
    SELECT order_number INTO v_order_no FROM public.orders WHERE id = NEW.order_id;

    SELECT id INTO v_existing
    FROM public.notifications
    WHERE type = 'production_needed'
      AND order_id = NEW.order_id
      AND is_read = false
    LIMIT 1;

    IF v_existing IS NULL THEN
      INSERT INTO public.notifications (title, description, type, order_id)
      VALUES (
        'تنبيه: مطلوب تصنيع',
        'الطلب ' || COALESCE(v_order_no,'-') || ' يحتاج تصنيع للصنف "' || v_name ||
        '" (المطلوب: ' || NEW.quantity::int || '، المتاح: ' || v_stock || ')',
        'production_needed',
        NEW.order_id
      )
      ON CONFLICT (order_id) WHERE type = 'production_needed' AND is_read = false AND order_id IS NOT NULL
      DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Mark manufacturing alerts read when the order is no longer actionable.
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

    if new.status in ('delivered', 'cancelled', 'returned') then
      update public.notifications
      set is_read = true
      where order_id = new.id
        and type = 'production_needed'
        and is_read = false;
    end if;
  end if;

  return new;
end;
$function$;
