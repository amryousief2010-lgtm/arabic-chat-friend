---
name: Mandatory Internal Messages (GM)
description: رسائل المدير العام الإلزامية داخل الرسائل الداخلية — حجب الواجهة حتى الرد وتتبع حالات الرد
type: feature
---

- `internal_messages.requires_reply` + `reply_due_at`، و`internal_message_recipients.replied_at`.
- المدير العام فقط يستطيع إرسال رسالة `requires_reply=true` (حارس `im_guard_requires_reply`).
- الرد يتم حصريًا عبر RPC `im_send_reply(p_message_id, p_body)` — يسجل الرد ويضبط `replied_at` في معاملة واحدة؛ الرد الفارغ مرفوض (`empty_reply_not_allowed`) وغير المشارك مرفوض (`not_a_participant`).
- `replied_at` للقراءة فقط من العميل، وممنوع الأرشفة قبل الرد (`reply_required_before_archive`) عبر `imr_guard_recipient_update`.
- `MandatoryMessagesGate` مثبت داخل `DashboardLayout` ويحجب الاستخدام (لا Esc/لا إغلاق) حتى إرسال رد فعلي، مرتب بالأولوية ثم الأقدم.
- المرسل (المدير العام) يرى في تفاصيل الرسالة وتبويب المرسلة: قرأ / رد / بانتظار الرد / متأخر.
- صفحة مستقلة `/mandatory-messages` (`src/pages/internal-messages/MandatoryMessages.tsx`) بها تبويب «الواردة إليّ» للرد المباشر و«لوحة التتبع» للمدير العام.
- العدّاد المشترك في `src/hooks/useMandatoryMessages.tsx` يغذّي شارة السايدبار وزر «الرسائل الإلزامية» داخل صفحة الرسائل الداخلية (Realtime).
