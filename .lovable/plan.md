# نظام الرسائل الداخلية (Internal Messages)

نظام رسائل مستقل تمامًا عن نظام الإشعارات الحالي، بدون أي تعديل عليه.

## 1. قاعدة البيانات (Migration واحدة)

### جداول جديدة

- `internal_messages` — `sender_id`, `subject`, `body`, `priority` ('normal' | 'important' | 'urgent'), `has_attachments`, `is_deleted`
- `internal_message_recipients` — `message_id`, `recipient_id`, `read_at`, `archived_at` (UNIQUE على message_id + recipient_id)
- `internal_message_attachments` — `message_id`, `file_url`, `file_name`, `file_type`, `file_size`, `uploaded_by`
- `internal_message_replies` — `message_id`, `sender_id`, `body`

كل جدول: `id uuid pk`, `created_at`, GRANT للـ `authenticated` و `service_role`, RLS مُفعّل.

### دالة أمان (لتجنّب Recursion)

```sql
public.is_message_participant(_message_id uuid, _user_id uuid)
-- TRUE إذا كان المستخدم المرسل أو ضمن المستلمين
```

### سياسات RLS الأساسية

- **internal_messages**: 
  - SELECT: `sender_id = auth.uid()` OR `is_message_participant(id, auth.uid())`
  - INSERT: `sender_id = auth.uid()`
  - UPDATE (soft delete): المرسل فقط
- **internal_message_recipients**:
  - SELECT: للمشاركين في الرسالة فقط
  - INSERT: المرسل يضيف المستلمين عند الإرسال
  - UPDATE: `recipient_id = auth.uid()` فقط (للقراءة والأرشفة)
- **attachments / replies**: SELECT/INSERT للمشاركين فقط، عبر `is_message_participant`
- **لا استثناء للمدير العام/التنفيذي** — خصوصية كاملة.

### Realtime

تفعيل `supabase_realtime` على الجداول الأربعة.

### Storage

Bucket: `internal-message-attachments` (private). 
سياسات على `storage.objects`: المرفوع والمشارك في الرسالة يقرأ، المرسل يرفع تحت مسار `{message_id}/...`.

## 2. الواجهة (Frontend)

### مسارات وملفات جديدة

- `src/pages/internal-messages/InternalMessages.tsx` — صفحة بتبويبات (وارد / مرسل / مؤرشف)
- `src/pages/internal-messages/MessageDetails.tsx` — تفاصيل + ردود + مرفقات
- `src/components/internal-messages/ComposeMessageDialog.tsx` — فورم رسالة جديدة (متعدد المستلمين + مرفق)
- `src/components/internal-messages/MessageList.tsx` — قائمة موحدة لكل تبويب
- `src/components/internal-messages/MessageItem.tsx` — صف رسالة (مرسل/عنوان/مقتطف/أولوية/تاريخ/مرفق)
- `src/components/internal-messages/RecipientSelector.tsx` — بحث متعدد من `profile_directory` + `user_roles`
- `src/components/internal-messages/AttachmentUploader.tsx` — رفع صور
- `src/components/internal-messages/PriorityBadge.tsx`
- `src/components/internal-messages/NewMessageToast.tsx` — Toast realtime عام داخل التطبيق
- `src/hooks/useUnreadInternalMessages.tsx` — عداد realtime
- `src/hooks/useInternalMessageRealtime.tsx` — اشتراك للرسائل الجديدة + إظهار Toast

### تكامل عام

- إضافة Mount لـ `NewMessageToast` في `DashboardLayout` ليعمل في كل الصفحات.
- `SidebarMenuSections`: عنصر جديد "الرسائل الداخلية" بأيقونة `Mail` + Badge بعدد غير المقروء (يستخدم `useUnreadInternalMessages`).
- `AnimatedRoutes`: مسارات `/internal-messages` و `/internal-messages/:id`.

### فلاتر صندوق الوارد

أزرار: الكل / غير مقروء / مهم / عاجل (state محلي + استعلام مفلتر).

### سلوك القراءة/الأرشفة

- فتح الرسالة → `UPDATE recipients SET read_at = now() WHERE message_id = ? AND recipient_id = auth.uid() AND read_at IS NULL`.
- زر "أرشفة" → `archived_at = now()` للمستخدم الحالي فقط.
- في تبويب "المرسل": عرض حالة كل مستلم (قرأ ✓ / لم يقرأ) من `read_at`.

### الردود (Thread)

تظهر مرتبة زمنيًا أسفل تفاصيل الرسالة، مع مربع كتابة رد. أي مشارك (مرسل أو مستلم) يستطيع الرد.

### Realtime

- اشتراك على `internal_message_recipients` بفلتر `recipient_id=eq.<me>` لتحديث القائمة والعداد فورًا.
- اشتراك على `internal_messages` لاستخراج بيانات الرسالة الجديدة وعرض Toast (يجلب اسم المرسل من `profile_directory`).
- اشتراك على `internal_message_replies` داخل صفحة التفاصيل.

## 3. ما لن يُلمس

- جدول `notifications` وكل ما يخصه — كما هو تمامًا.
- صفحة `Notifications.tsx` و `useUnreadNotifications` — لا تغيير.
- لا Push Notifications، لا SMS، لا Edge Functions.

## 4. الاختبار اليدوي بعد التنفيذ

سيناريوهات الإرسال متعدد الأدوار، الرفع، Realtime، العداد، الأرشفة الخاصة، الفصل عن صفحة الإشعارات.

---

هل أبدأ التنفيذ مباشرة بهذا الشكل؟
