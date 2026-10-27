-- ════════════════════════════════════════════════════════════════════════════
-- POST-DEPLOY SCRIPT — NOT A MIGRATION. يُشغَّل يدوياً مرة واحدة بعد تطبيق migrations الخطوة 1.
-- ملء orders.moderator_id للطلبات القديمة من النص orders.moderator (مطابقة تامة بعد التطبيع، بلا تخمين).
-- آمن للتكرار: يلمس فقط الصفوف التي moderator_id فيها NULL ولها مطابقة.
-- على دفعات 500 صف بالترتيب على id، مع COMMIT بعد كل دفعة (أقفال قصيرة).
--
-- التشغيل (لا يُشغَّل من CI ولا من الـ migrations):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cm/post_deploy_backfill_orders_moderator_id.sql
--   psql ... -v skip_user_triggers=on -f ...   ← اختياري، انظر أدناه
--
-- ما الذي يعمل من triggers جدول orders عند UPDATE لعمود moderator_id فقط (قُرئت تعريفاتها في supabase/migrations):
--   يعمل وله أثر:
--     update_orders_updated_at (BEFORE UPDATE)      → updated_at = now() لكل صف يُملأ. هذا هو الأثر الحقيقي الوحيد.
--   يعمل بلا أثر:
--     trg_lock_manual_waybill (BEFORE UPDATE)       → عند postgres بلا JWT يرجع NEW فوراً؛ لا يغيّر بوليصة.
--     trg_set_order_delivered_at (BEFORE UPDATE)    → status لم يتغير → لا تغيير.
--     trg_log_order_status_audit (AFTER UPDATE)     → يكتب فقط عند تغيّر status/payment/collection/delivered_at → لا صفوف.
--     trg_bulk_delivery_cap_update (AFTER, statement) → يرجع فوراً لـ postgres، ولا توجد صفوف تحولت لـ delivered.
--   لا يعمل (مقيّد بأعمدة أخرى): orders_set_source_warehouse، trg_00_reject_premature_dispatched،
--     trg_block_moderator_status_change، trg_enforce_order_fulfillment_source، trg_handle_order_status_stock،
--     trg_notify_* (status/insert)، trg_validate_*، trg_cm_orders_moderator_id (OF moderator).
--   لا إشعارات ولا حركات مخزون ولا سجل تدقيق ولا اتصال بشركة شحن.
--   ملاحظة: triggers موجودة على القاعدة الحية خارج ملفات الريبو لا يمكن التحقق منها من هنا — راجع:
--     SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.orders'::regclass AND NOT tgisinternal;
--
-- skip_user_triggers=on: يضبط session_replication_role=replica للجلسة فيوقف كل triggers المستخدم (ومنها updated_at)
--   ويحفظ updated_at كما هو. يتطلب صلاحية ضبط هذا الإعداد (superuser أو GRANT SET)؛ إن لم تتوفر يفشل السكربت
--   قبل أي تعديل. تم التحقق منه محلياً فقط (Postgres 17) في supabase/tests/cm_step1_test.sql.
--   تنبيه: replica يوقف أيضاً فحوص المفاتيح الأجنبية؛ القيم هنا من cm_moderator_id_for_name فهي موجودة دائماً.
-- ════════════════════════════════════════════════════════════════════════════
\if :{?skip_user_triggers}
\else
  \set skip_user_triggers off
\endif
SELECT set_config('cm.backfill_skip_user_triggers', :'skip_user_triggers', false);

DO $$
DECLARE
  v_skip boolean := current_setting('cm.backfill_skip_user_triggers', true) = 'on';
  v_last uuid := '00000000-0000-0000-0000-000000000000';
  v_ids uuid[];
  v_n int;
  v_total int := 0;
  v_batches int := 0;
BEGIN
  IF v_skip THEN
    PERFORM set_config('session_replication_role', 'replica', false);
  END IF;
  LOOP
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM (
      SELECT o.id FROM public.orders o
      WHERE o.id > v_last AND o.moderator_id IS NULL AND o.moderator IS NOT NULL AND btrim(o.moderator) <> ''
      ORDER BY o.id LIMIT 500) s;
    EXIT WHEN v_ids IS NULL;
    UPDATE public.orders o SET moderator_id = public.cm_moderator_id_for_name(o.moderator)
    WHERE o.id = ANY (v_ids) AND o.moderator_id IS NULL
      AND public.cm_moderator_id_for_name(o.moderator) IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    v_batches := v_batches + 1;
    v_last := v_ids[array_length(v_ids, 1)];
    COMMIT;
  END LOOP;
  IF v_skip THEN
    PERFORM set_config('session_replication_role', 'origin', false);
  END IF;
  RAISE NOTICE 'cm backfill: % rows updated in % batches (skip_user_triggers=%)', v_total, v_batches, v_skip;
END $$;
