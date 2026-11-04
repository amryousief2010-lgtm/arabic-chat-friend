-- غير مطبق (يحتاج موافقة م. عمرو): تحديث مباشر للوحة البنات. orders موجود أصلاً في supabase_realtime.
-- ملاحظة: Realtime يحترم RLS، فكل مستخدم يستقبل فقط الصفوف المسموح له بقراءتها.
ALTER PUBLICATION supabase_realtime ADD TABLE public.cm_conversations, public.cm_messages;
-- ROLLBACK:
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.cm_conversations, public.cm_messages;
