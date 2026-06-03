
DELETE FROM public.brooding_feed_issuance
WHERE notes LIKE '[اختبار آلي]%' AND created_at > now() - interval '10 minutes';

DELETE FROM public.brooding_feed_stock_movements
WHERE notes LIKE '[اختبار آلي]%' AND created_at > now() - interval '10 minutes';

DELETE FROM public.notifications
WHERE title='صرف علف من مخزون الكتاكيت' AND created_at > now() - interval '10 minutes';
