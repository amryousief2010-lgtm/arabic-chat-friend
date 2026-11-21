-- للموافقة فقط. علامة «مستني رد» (cm_conversations.awaiting_reply_since) فيها 951 محادثة، 725 منها قديمة
-- (اترد عليها بعد العلامة، أو العلامة أقدم من 7 أيام). الأرقام من قراءة 21/11/2026 الساعة 3 الفجر بتوقيت الرياض.
-- محرك التنبيهات الجديد مش بيعتمد على العمود ده (بيحسب من last_inbound_at / last_outbound_at)، فده تنضيف للشاشات بس.
SELECT count(*) FILTER (WHERE awaiting_reply_since IS NOT NULL) AS flagged,
       count(*) FILTER (WHERE awaiting_reply_since IS NOT NULL AND (last_outbound_at >= awaiting_reply_since OR awaiting_reply_since < now() - interval '7 days')) AS stale
FROM public.cm_conversations;

BEGIN;
SET LOCAL statement_timeout = '20s';
UPDATE public.cm_conversations
SET awaiting_reply_since = NULL, updated_at = now()
WHERE awaiting_reply_since IS NOT NULL
  AND (last_outbound_at >= awaiting_reply_since OR awaiting_reply_since < now() - interval '7 days');
ROLLBACK;
