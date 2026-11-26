-- cm_awaiting_reply_fix_18_rows (GM approval 2026-11-20 21:23 Riyadh): recompute awaiting_reply_since from actual message order
-- only the 18 ids in this class at ~21:25 Riyadh (the reported set + re-occurrences incl. 4a78a585, b59470f6), only awaiting_reply_since.
UPDATE public.cm_conversations c SET awaiting_reply_since = (
  SELECT public.cm_clock_start(min(m.sent_at)) FROM public.cm_messages m
  WHERE m.conversation_id = c.id AND m.direction = 'in' AND NOT m.is_history
    AND m.sent_at > coalesce(c.last_outbound_at, '-infinity'))
WHERE c.id IN ('a5802c62-544e-408d-9978-3e631878f686','5aa97485-8803-4883-9128-8d8568139f3f','a9a0bc54-8680-4646-b892-02209b5156ef','15c0aa2f-80d5-4c0a-b198-f87ca78f9b45','1b0a1489-a574-4f1e-b06f-8d612b986820','9058d95f-c8b8-47c8-b674-2da0a342e4f2','a9ea3e0a-6403-4b82-b71e-b500555ea737','fa8cadb8-8c1c-4e19-8c5e-269a913808c5','b54fcc4f-b1a3-43e5-b2fc-ab91e06fb80c','8b4cc23f-ee8f-412a-a3fa-deb4902c3b00','7b2747a9-cd6f-44b0-948e-c1483e4cf392','a299258e-73ab-4a7b-a04d-394a1f3a7d01','143d0c49-725a-48eb-b67a-12288db342e5','aff5a3f8-2bca-496a-a5d5-8197e364c190','84aaf745-53c7-4960-8960-ca8a09059f05','eac83ff9-f908-4bbf-80b9-06f1eceecf02','4a78a585-d35a-4e7f-9801-74480d9abd82','b59470f6-6a06-4cc3-9ac3-724737b58ce6')
  AND c.awaiting_reply_since < c.last_outbound_at;
