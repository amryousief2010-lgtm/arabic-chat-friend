
# خطة تنفيذ دور مسؤول السوشيال ميديا (social_media_manager)

## 1. تعديلات قاعدة البيانات (Migration واحد)

### إضافة الدور للـ enum
```sql
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'social_media_manager';
```

### جدول `social_media_daily_reports`
الحقول الأساسية: `report_date`, `employee_id`, `employee_name`, `posts_count`, `reels_videos_count`, `interested_customers_count`, `top_engaging_content`, `issues_or_complaints`, `tomorrow_content_suggestions`, `additional_notes`, `status` (draft/submitted/reviewed), `management_notes`, `reviewed_by`, `reviewed_at`.
- Unique: `(employee_id, report_date)`
- GRANTs + RLS + trigger للـ `updated_at`.

### جدول `social_media_weekly_reports`
الحقول: `week_start_date`, `week_end_date`, `employee_id`, `employee_name`, نمو المتابعين لـ FB/IG/TikTok/YouTube, `leads_count`, `best_platform`, `best_platform_reason`, `repeated_problems`, `weekly_summary`, `next_week_suggestions`, `additional_notes`, `status`, `management_notes`, `reviewed_by`, `reviewed_at`.
- Unique: `(employee_id, week_start_date, week_end_date)`

### جدول `social_media_weekly_top_posts`
- FK لـ `social_media_weekly_reports(id) ON DELETE CASCADE`
- الحقول: `platform`, `post_title`, `post_url`, `reach_count`, `engagement_count`, `notes`.

### سياسات RLS
- **social_media_manager**: INSERT/SELECT/UPDATE للسجلات الخاصة به فقط، والـ UPDATE مشروط بـ `status <> 'reviewed'`. لا DELETE.
- **general_manager / executive_manager / marketing_sales_manager**: SELECT كامل + UPDATE لحقول المراجعة فقط (نعتمد على has_role).
- **حماية الطلبات للقراءة فقط لهذا الدور**: لا نضيف أي policy تسمح لـ social_media_manager بـ INSERT/UPDATE/DELETE على `orders` / `order_items` / `customers`. (السياسات الحالية تعتمد على أدوار محددة لا تشمله، لذا الرفض تلقائي.)
- نضيف policy SELECT للطلبات تسمح لـ social_media_manager بالقراءة فقط.

## 2. تحديث `useAuth.tsx`
- إضافة `'social_media_manager'` في `AppRole`.
- إضافة `isSocialMediaManager`, `canManageSocial` helpers.
- تعديل `priority` لإدراج الدور.

## 3. تحديث `ProtectedRoute.tsx`
- إضافة قائمة `SOCIAL_MEDIA_ALLOWED_PREFIXES`:
  `/orders` (قراءة فقط), `/social-media/daily`, `/social-media/weekly`, `/social-media/my-reports`, `/notifications`, `/permissions`, `/auth`, `/install`.
- redirect target: `/social-media/daily`.

## 4. الصفحات الجديدة (تحت `src/pages/social-media/`)
1. **`SocialMediaDailyReport.tsx`** — فورم اليومي + قائمة "تقاريري السابقة" + منع التكرار (upsert/check).
2. **`SocialMediaWeeklyReport.tsx`** — فورم الأسبوعي مع جدول أعلى 5 منشورات + حفظ.
3. **`SocialMediaMyReports.tsx`** — قائمة موحدة لتقاريرها (يومي/أسبوعي) مع شارة الحالة.
4. **`SocialMediaReportsReview.tsx`** — للإدارة: تبويبان (يومية/أسبوعية) + فلاتر + اعتماد + ملاحظات.

## 5. حماية صفحة الطلبات في الواجهة
- في `src/pages/Orders.tsx`: عند `isSocialMediaManager` نخفي/نعطّل أزرار: إضافة طلب جديد، تعديل، حذف، تغيير الحالة، تصدير. ونعرض شارة "قراءة فقط".
- اعتمادًا قاعديًا على RLS لرفض أي عملية كتابة.

## 6. السايد بار (`AppSidebar` / `SidebarMenuSections`)
- إخفاء كل العناصر لـ social_media_manager ما عدا:
  - مراجعة الطلبات (`/orders`)
  - تقرير السوشيال ميديا اليومي
  - تقرير السوشيال ميديا الأسبوعي
  - تقاريري السابقة
- للأدوار الإدارية المعنية: إضافة عنصر "مراجعة تقارير السوشيال ميديا".

## 7. التوجيه في `AnimatedRoutes.tsx`
إضافة المسارات الأربعة الجديدة مع `<ProtectedRoute allowedRoles={...}>`.

## 8. إنشاء حساب جنة سامح
بعد تطبيق الـ migration، يقوم المدير العام بإنشاء الحساب من شاشة الموظفين وتعيين دور `social_media_manager` (أو نضيفه من شاشة الإدارة).

## ملاحظات تقنية
- جميع الجداول تحصل على `GRANT SELECT, INSERT, UPDATE ON ... TO authenticated; GRANT ALL ... TO service_role;` (بدون DELETE للجميع، يبقى DELETE لـ service_role فقط).
- استخدام `has_role(auth.uid(), 'role')` في كل السياسات لتفادي recursion.
- شارات الحالة والـ RTL تتبع الـ design system الحالي (Purple/Orange tokens).
- لا تعديل على نظام الرسائل الداخلية ولا على `customers` ولا الخزائن لهذا الدور.

هل أبدأ التنفيذ؟
