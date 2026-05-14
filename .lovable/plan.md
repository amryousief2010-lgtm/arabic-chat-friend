# خطة تحويل المشروع إلى نظام داخلي خاص بشركة نعام العاصمة

سيتم تنفيذ التغييرات على أربعة محاور: المصادقة، حماية المسارات، حظر محركات البحث/الذكاء الاصطناعي، وتأمين قاعدة البيانات.

---

## 1) المصادقة (Authentication)

**الوضع الحالي:** التطبيق فعلياً يستخدم Supabase Auth ومعظم الصفحات محمية عبر `ProtectedRoute`. لكن سنشدد الإعدادات.

**التغييرات:**
- `src/pages/Auth.tsx` — إخفاء/إزالة تبويب التسجيل (Sign Up) كلياً، الإبقاء على تسجيل الدخول فقط. إضافة شرح: "إنشاء الحسابات يتم عبر الإدارة فقط".
- `supabase--configure_auth` — تعيين `disable_signup: true` لمنع التسجيل العام عبر API.
- `src/App.tsx` — التأكد أن `AnimatedRoutes` يلف كل شيء بـ `ProtectedRoute` افتراضياً.
- `src/components/AnimatedRoutes.tsx` — مراجعة كل `<Route>` لضمان أن المسار الوحيد العام هو `/auth` (و `/install` و `/reset-password` إن وجد). أي مسار آخر — بما فيه `/` — يتطلب تسجيل دخول.
- التأكد من وجود زر "تسجيل الخروج" في `Header` / `MobileNavigation` (موجود سابقاً، سنتحقق فقط).
- إزالة مسار `/seed-users` نهائياً من الإنتاج (محمي حالياً بـ `import.meta.env.DEV` لكن سنحذف الملف من البناء).

---

## 2) حماية المسارات (Route Protection)

**التغييرات:**
- `src/components/AnimatedRoutes.tsx`:
  - المسار `/` → `<ProtectedRoute>` (موجود).
  - أي مسار غير `/auth` يتم تغليفه إجبارياً.
  - إضافة `<Route path="*" element={<Navigate to="/auth" replace />} />` للمسارات غير الموجودة عند المستخدمين غير المسجلين.
- `src/components/ProtectedRoute.tsx`:
  - عند `!user` يعيد التوجيه إلى `/auth` (موجود) — سنضيف منع كاش (`replace`) ومسح أي حالة سابقة.

المسارات التي سيتم التأكد من حمايتها (كلها موجودة في AnimatedRoutes):
`/`, `/dashboard`, `/orders`, `/orders/new`, `/orders/:id`, `/customers`, `/products`, `/employees`, `/reports`, `/sales-targets`, `/notifications`, `/settings`, `/permissions`, `/org-chart`, `/team-performance`, `/moderator-performance`, `/offer-boxes`, `/low-stock`, `/manufacturing-queue`, `/stock-replenishment`, `/import-sales`, `/executive-dashboards`, وكل `/modules/*` (warehouses, farm, hatchery, brooding, slaughterhouse, meat-factory, feed-factory, hr).

---

## 3) حظر محركات البحث والذكاء الاصطناعي (SEO Blocking)

**التغييرات:**

- **`public/robots.txt`** (إعادة كتابة كاملة):
  ```
  User-agent: *
  Disallow: /
  
  User-agent: GPTBot
  Disallow: /
  
  User-agent: ChatGPT-User
  Disallow: /
  
  User-agent: Google-Extended
  Disallow: /
  
  User-agent: anthropic-ai
  Disallow: /
  
  User-agent: ClaudeBot
  Disallow: /
  
  User-agent: CCBot
  Disallow: /
  
  User-agent: PerplexityBot
  Disallow: /
  ```

- **`index.html`**:
  - إضافة: `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex" />`
  - إضافة: `<meta name="googlebot" content="noindex, nofollow" />`
  - تغيير `<title>` و`description` إلى محتوى عام محايد: "نظام داخلي - الدخول مقيد".
  - إزالة Open Graph / Twitter cards (لمنع المعاينة عبر الروابط).
  - إزالة `og:image`.

- **حذف ملفات SEO إن وُجدت:**
  - `public/sitemap.xml` (إن وُجد) — لا يوجد حالياً.
  - `public/llms.txt` (إن وُجد) — لا يوجد حالياً.
  - `scripts/generate-sitemap.ts` (إن وُجد) — لا يوجد حالياً.

---

## 4) أمان قاعدة البيانات (Database Security)

**الوضع الحالي:** كل الجداول الحساسة (orders, customers, products, profiles, user_roles ...) لديها RLS مفعّل وسياسات مبنية على `has_any_role` و`auth.uid()`. لا توجد سياسات `USING (true)` للقراءة العامة بدون مصادقة — كل السياسات مقيدة بـ `authenticated` أو دور محدد.

**ما سيتم فحصه/تعديله:**
- تشغيل `supabase--linter` للكشف عن أي جداول بدون RLS أو سياسات متساهلة.
- مراجعة جدول `notifications` و`profiles` للتأكد أن لا أحد بدون مصادقة يستطيع القراءة.
- التأكد أن لا يوجد bucket تخزين عام (لا توجد buckets حالياً — تم التحقق).
- لا توجد مفاتيح `service_role` في الفرونت (تم التحقق — `.env` يحوي فقط `VITE_SUPABASE_PUBLISHABLE_KEY` وهو المفتاح العام).

**RBAC:** النظام يطبق فعلياً RBAC كامل عبر `app_role` enum و`has_role`/`has_any_role` (موثق في الذاكرة). الأدوار المطلوبة (Admin/Sales/Accounting/Inventory/Production/Hatchery/Slaughterhouse/Logistics/Management) مغطاة بالأدوار الموجودة:
- Admin → `general_manager`, `executive_manager`
- Sales → `sales_manager`, `sales_moderator`, `marketing_sales_manager`
- Accounting → `accountant`, `financial_manager`
- Inventory → `warehouse_supervisor`
- Production → `production_manager`, `feed_factory_manager`, `meat_factory_manager`
- Hatchery → `hatchery_manager`, `brooding_manager`, `farm_manager`
- Slaughterhouse → `slaughterhouse_manager`
- Logistics → `shipping_company`
- Management → `general_manager`, `executive_manager`, `quality_manager`, `hr_manager`

لن يتم تغيير الـ enum، فقط التحقق أن السياسات الموجودة تطابق المتطلبات.

---

## 5) قائمة الفحص الأمني (Security Checklist)

بعد التنفيذ سأقدم قائمة فحص:
- [ ] فتح `/` بدون تسجيل دخول → يعيد التوجيه إلى `/auth`.
- [ ] فتح `/dashboard`, `/orders`, `/customers` ... → كلها تعيد التوجيه.
- [ ] `curl https://coceg.net/robots.txt` → يحتوي `Disallow: /`.
- [ ] `curl https://coceg.net/` → الـ HTML يحتوي `noindex, nofollow`.
- [ ] لا يوجد `sitemap.xml` ولا `llms.txt`.
- [ ] صفحة Auth لا تعرض زر إنشاء حساب.
- [ ] Supabase linter بدون تحذيرات حرجة.
- [ ] لا توجد buckets تخزين عامة.

---

## الملفات التي ستُعدّل/تُحذف

**تعديل:**
1. `public/robots.txt` — حظر شامل لكل الزواحف.
2. `index.html` — meta noindex + عنوان محايد + إزالة OG.
3. `src/pages/Auth.tsx` — إخفاء التسجيل العام.
4. `src/components/AnimatedRoutes.tsx` — التحقق من تغليف كل المسارات + catch-all.
5. إعدادات Supabase Auth — `disable_signup: true`.

**حذف (إن وُجد، حالياً غير موجودة):**
- `public/sitemap.xml`, `public/llms.txt`, `scripts/generate-sitemap.ts`.

**لا تغييرات على قاعدة البيانات** سوى تشغيل linter للتحقق — السياسات الحالية كافية وفق المراجعة.

---

## ملاحظة هامة

الـ Frontend يبقى تطبيق Single-Page React. هذا يعني أن ملفات JS/CSS قابلة للتنزيل تقنياً من أي شخص يعرف الرابط، لكنها بدون تسجيل دخول لا تعرض أي بيانات (كل البيانات محمية بـ RLS على Supabase). هذا هو المعيار الصناعي للتطبيقات الداخلية المبنية كـ SPA. لو أردت إخفاء حتى الـ HTML/JS عن الزوار غير المسجلين فهذا يتطلب Reverse Proxy (Cloudflare Access مثلاً) — أخبرني إن أردت أن أرشدك لهذا الخيار بعد التنفيذ.
