# كيفية التحكم بمكان عناصر السايدبار

ملف الإعدادات: [`src/config/sidebarOverrides.ts`](../src/config/sidebarOverrides.ts)

الغرض من هذا الملف هو تعديل **مكان** أو **صلاحية الوصول** لأي عنصر في القائمة الجانبية دون تعديل مباشر لملف `SidebarMenuSections.tsx`. المرجع الأساسي لتعريف العناصر (الأيقونة، الاسم، الأدوار) يبقى داخل مصفوفة `moduleSections`.

---

## 1) نقل عنصر من قسم إلى آخر — `SIDEBAR_ITEM_MOVES`

كل عنصر في المصفوفة يمثل نقلة واحدة:

```ts
{
  path: "/sales/daily-performance-analysis", // العنصر (مطابق لـ path في moduleSections)
  toSectionId: "social-media",               // القسم الهدف (id في moduleSections)
  after: "/social-media/marketing-dashboard" // اختياري: يُوضع بعد هذا العنصر مباشرة
}
```

- إذا لم تُحدّد `after`، يُضاف العنصر في نهاية القسم الهدف.
- إذا كانت قيمة `after` غير موجودة في القسم الهدف، يُضاف العنصر في النهاية أيضًا.

### مثال: نقل "أداء الفريق" مؤقتًا إلى قسم السوشيال ميديا

```ts
export const SIDEBAR_ITEM_MOVES: SidebarItemMove[] = [
  {
    path: "/team-performance",
    toSectionId: "social-media",
    after: "/social-media/marketing-dashboard",
  },
];
```

### الرجوع إلى الوضع الأساسي

احذف السطر أو المصفوفة بأكملها ليعود العنصر تلقائيًا لقسمه الأصلي المُعرّف داخل `moduleSections`:

```ts
export const SIDEBAR_ITEM_MOVES: SidebarItemMove[] = [];
```

> ملاحظة: النقل لا يغيّر `roles` الخاصة بالعنصر — الأدوار المسموح لها بالرؤية تبقى كما هي.

---

## 2) السماح لمستخدم التسويق فقط (محمد سيد) بالوصول لمسار خارج قسم `/social-media` — `MARKETING_ONLY_EXTRA_PREFIXES`

المستخدم الذي يحمل دور `marketing_sales_manager` **وحده** يخضع لقائمة سماح صارمة. أي مسار خارج `/social-media` و`/reports` و`/notifications` وما شابه يتم إخفاؤه من السايدبار وإعادة توجيهه بواسطة `ProtectedRoute`.

لإتاحة مسار إضافي له مع بقاء العنصر في قسمه الأصلي (بدون نقله)، أضِف بادئة المسار:

```ts
export const MARKETING_ONLY_EXTRA_PREFIXES: string[] = [
  "/sales/daily-performance-analysis",
  "/team-performance",       // ← يظهر داخل قسم "التسويق والمبيعات" ويُفتح بدون إعادة توجيه
  "/moderator-performance",
];
```

يعمل نفس المصدر لكل من:
- `SidebarMenuSections.tsx` — لإظهار العنصر في القائمة.
- `ProtectedRoute.tsx` — للسماح بفتح الصفحة.

### مثال: إزالة الوصول لاحقًا

احذف السطر المطلوب من المصفوفة، وسيختفي العنصر تلقائيًا من سايدبار محمد سيد ولن يستطيع فتح الصفحة مباشرة.

---

## 3) الأدوار الأخرى غير متأثرة

- المستخدمون متعددو الأدوار (مثل آلاء: `sales_manager` + `marketing_sales_manager`) لا يخضعون لقائمة السماح — يرون كل ما يسمح به دورهم الآخر.
- المديرون (`general_manager`, `executive_manager`, `sales_manager`) يعتمدون فقط على `roles` المعرّفة في `moduleSections`.

---

## 4) الاختبارات

يتم التحقق من قواعد الوصول والترتيب تلقائيًا في:

- `src/test/protected-route-marketing-only.test.tsx` — يمنع أي مسار خارج قائمة السماح لمحمد سيد ويؤكد وصول الأدوار متعددة الوظائف.
- `src/test/sidebar-performance-icons-placement.test.tsx` — يؤكد أن "أداء الفريق" يظهر مباشرة قبل "أداء الموديراتور" داخل قسم `sales` لجميع الأدوار المسموح لها.

شغّلها بالأمر:

```bash
bunx vitest run src/test/protected-route-marketing-only.test.tsx src/test/sidebar-performance-icons-placement.test.tsx
```
