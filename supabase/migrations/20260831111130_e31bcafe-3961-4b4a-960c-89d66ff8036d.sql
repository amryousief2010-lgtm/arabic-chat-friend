create or replace function public.notify_order_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

    -- shared notification (managers/warehouse views)
    insert into public.notifications(title, description, type, order_id)
    values ('📦 تحديث حالة الطلب',
            'الطلب ' || coalesce(new.order_number,'') || ' أصبح: ' || v_label,
            'status_update', new.id);

    -- targeted notification for the order creator (moderator)
    if new.created_by is not null then
      insert into public.notifications(title, description, type, order_id, target_user_id)
      values ('📦 تحديث حالة طلبك',
              'الطلب ' || coalesce(new.order_number,'') || ' أصبح: ' || v_label,
              'status_update', new.id, new.created_by);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_order_lifecycle() from public, anon, authenticated;

drop trigger if exists trg_notify_order_lifecycle_insert on public.orders;
create trigger trg_notify_order_lifecycle_insert
after insert on public.orders
for each row execute function public.notify_order_lifecycle();

drop trigger if exists trg_notify_order_lifecycle_status on public.orders;
create trigger trg_notify_order_lifecycle_status
after update of status on public.orders
for each row execute function public.notify_order_lifecycle();