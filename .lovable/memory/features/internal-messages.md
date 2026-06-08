---
name: Internal Messages System
description: Standalone in-app messaging — separate tables, separate route, separate Realtime, separate unread badge. Never merge with notifications.
type: feature
---
- Tables: internal_messages, internal_message_recipients, internal_message_attachments, internal_message_replies. RLS scoped strictly to participants via `public.is_message_participant(message_id, user_id)`; NO admin bypass — even general_manager cannot read messages they are not part of.
- Storage bucket `internal-message-attachments` is PRIVATE. Use `useSignedAttachmentUrl` (1h signed URLs) to render images.
- Routes: `/internal-messages` (tabs: inbox/sent/archived + filters: all/unread/important/urgent), `/internal-messages/:id` (details + thread + reply).
- Read/archive (`read_at`, `archived_at`) live on `internal_message_recipients` per-recipient — never mutate other recipients' state.
- Unread badge on sidebar via `useUnreadInternalMessages` (realtime on `internal_message_recipients` filtered by `recipient_id=eq.<me>`).
- In-app toast on new message via `useInternalMessageRealtime` mounted in DashboardLayout. No push, no SMS.
- Do NOT touch `notifications` table, `useUnreadNotifications`, `Notifications.tsx`, or `SendMessage.tsx` — those are a separate legacy system kept as-is.
