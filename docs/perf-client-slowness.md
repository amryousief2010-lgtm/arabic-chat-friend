# لماذا التطبيق بطيء؟ — تشخيص أداء الواجهة

تاريخ القياس: 19 سبتمبر 2026  
الهدف: تقرير أسباب مرتّب حسب الأثر + تعديلات P0 على مسار القراءة فقط (بدون مسح بيانات).  
الإنتاج المقاس: `https://coceg.net` (deployment `f6c0cc03-…`)  
جلسة عمرو المسجّلة: `preview--naam-alasima.lovable.app` (إعادة تحميل المخازن)

---

## ملخص عربي للمنسّق / مالك المنتج

التطبيق مش «بطيء في السيرفر» قد ما هو **بيحمّل بيانات كتير جدًا على جهاز المستخدم ويعيد تحميلها مع كل حركة**.

أهم 5 أسباب:

1. **شاشة الطلبات بتجيب الشهر كله على الديسكتوب** وتعرض كل صف ككارت ثقيل من غير ترقيم حقيقي. أي فلتر منتج يمسح جدول بنود الطلبات كامل (~12 ألف طلب مذكور في الكود).
2. **كل طلب جديد يعيد تحميل شاشات كاملة** (مخزن / بطاقات المسوقات / لوحة المدير) لأن الاشتراك اللحظي على جدولي `orders` و `order_items` بيشغّل جلب ضخم من غير تهدئة.
3. **لوحة التحكم بتجيب مبيعات السنة كلها على المتصفح** (آلاف الطلبات + كل أصنافها) وفي نفس الوقت دالة قاعدة بيانات بتعمل مسح لكل الطلبات.
4. **ملف الجافاسكريبت الأول 2 ميجا** قبل الضغط، ومكتبات التصدير (Excel ~917 كيلو) بتتحمّل مع فتح الشاشة مش عند الضغط على الزر.
5. **شاشة المخازن بتجيب كل الأصناف وكل الحركات** (استعلام لكل مخزن) حتى لو المستخدم فاتح تاب واحد.

اللي اتعمل في الـ PR (مسار القراءة فقط — مفيش DELETE/TRUNCATE):

- تأجيل اعتمادات الخزن / بلاغات الميجا / التنبيهات **ثانيتين** بعد فتح أي شاشة حتى الطلبات والمخازن ياخدوا الشبكة الأول
- شاشة المخازن: تاب الخزنة والأدوات الثقيلة `lazy` — مش بتتحمّل إلا لما المستخدم يفتحها
- `fetchAll` على مرحلتين: الأصناف أولاً ثم الحركات/الطلبات
- الطلبات: أول صفحة فقط + «تحميل المزيد» (وقف التحميل الخلفي لكل الشهر)
- ExcelJS/xlsx/html2canvas عند الضغط على تصدير فقط
- لوحة تحليلات الطلبات وتقرير المسوقة اليومي `lazy` — مش على مسار فتح الشاشة

P1 يحتاج صاحب مشروع Supabase: فهارس على `orders(created_at)` و `agouza_stock_reservations(order_id)` و `order_items(order_id)`.

---

## Live Network evidence — Amr warehouse reload (preview)

Logged-in session on `preview--naam-alasima.lovable.app`, warehouse hub reload:

| Metric | Value |
|---|---|
| Requests | **111** |
| Transferred | **2.3 MB** |
| Resources | **6.9 MB** |
| Finish | **6.22 s** |
| Main `index-*.js` | ~598 KB transferred / **~2.08 MB decoded** |
| exceljs | ~269 KB transferred |

Slow REST, all overlapping ~5–6.5s (connection herd, not 8 independent 6s queries):

| Endpoint | ~time | Who fires it on warehouse/orders mount |
|---|---:|---|
| `/rest/v1/agouza_stock_reservations` | 6.5s | `Orders.tsx` after orders land (every Agouza id in the loaded set) |
| `/profiles` | 5.8s | `useAuth` (own row) — queued behind the herd |
| `/user_roles` | 5.8s | `useAuth` + was also re-fetched by `DiscrepancyBanner` |
| `/order_mega_discrepancies` | 5.4s | `MegaDiscrepancyAlert` in **DashboardLayout** (every page) |
| `/orders` | 5.3s | Warehouses `fetchAll` (30 days, 1000) **and** Orders first page **and** discrepancy join |
| `/main_treasury_transactions` | 5.0s | `useExecutiveApprovals` — **sidebar + layout alert**, not the warehouse tab |
| `/lab_treasury_movements` | 4.9s | same hook + `useLabTreasuryApprovals` |
| `/order_items` | 4.2s | Orders first page (+ used to prefetch the rest of the month on desktop) |

**Why warehouse/orders mount looks like a full-app boot**

`DashboardLayout` (and the sidebar) always mount, for every route:

1. `useExecutiveApprovals` → **11 parallel table queries** including treasury
2. `useLabTreasuryApprovals` → lab treasury pending
3. `MegaDiscrepancyAlert` → discrepancies + orders + customers
4. `DuplicateApprovalsAlert`
5. notifications / messages / presence

On top of that, `Warehouses.tsx` used to **statically import** treasury, stock, reports, and the recharts dashboard (418 KB chunk → long centered `RouteFallback` spinner), then `fetchAll()` pulled warehouses + all items + 1000 orders + N+1 movements before the items table painted.

That is why Amr sees treasury REST on a warehouse reload even when the treasury **tab is not open**.

---

## Live bundle evidence (`coceg.net`)

| Asset | Raw | gzip |
|---|---:|---:|
| `/assets/index-sKlXhyLR.js` (entry) | 2.0 MB | ~586 KB |
| `exceljs.min-*.js` | 917 KB | ~264 KB |
| `Warehouses-*.js` | 418 KB | ~98 KB |
| `jspdf.es.min-*.js` | 381 KB | ~124 KB |
| `html2canvas.esm-*.js` | 198 KB | ~46 KB |
| `Orders-*.js` | 154 KB | ~40 KB |
| `WarehouseDetail-*.js` | 114 KB | ~27 KB |

- Code-splitting **exists** (292 lazy chunks). Routes are `lazy()` in `src/components/AnimatedRoutes.tsx`.
- `vite.config.ts` had **no `manualChunks`**, so React + Supabase + Radix + framer-motion sit in the 2 MB entry.
- Opening Orders still pulled `exceljs` because `exportOrdersSheet.ts` statically imported it (Excel button only).
- Edge functions (`sync-zodex-*`, `process-bostta-delivery`, `import-sales`, `ai-assistant-chat`) are **not** on the interactive hot path. They run on explicit user actions.

Related recent work (does **not** fix the issues below):

- PR #14 pins operational Orders filters to the current Cairo year.
- `.lovable/memory/features/marketing-dashboard-perf.md` already constrained marketing ranges.

---

## Ranked causes

### 1. P0 — Orders: unbounded client list + no virtualization

**Why it feels slow while working.** Desktop `fetchOrders` loads the first 100 rows, then **keeps paging the rest of the current month in a `while` loop** and `setOrders` after every page. The 4,200-line page then `filteredOrders.map(...)` **twice** (card view + table view) with no windowing. Each status/filter change re-renders the whole tree (analytics + cards + dialogs).

**Evidence**

- `src/pages/Orders.tsx` — `ORDERS_PAGE = 100`, then “على الديسكتوب فقط: أكمل التحميل تلقائيًا في الخلفية”.
- Product filter: paginates **all** `order_items` by `product_name` with no date bound (`ITEM_STEP = 1000`) before loading those orders.
- Moderator filter: `.limit(1000)` for that moderator’s orders + all their items.
- Comment in the same file: year-count queries evaluate RLS “across all ~12k orders”.
- `OrdersAnalytics` used to be **always mounted on desktop** (`showAnalytics` only gates mobile) and pulled recharts into the Orders chunk.
- `ModeratorDailyReportDialog` used to statically import `html2canvas` + `xlsx` into the Orders module graph. **Both are now lazy** — analytics loads in its own chunk; the daily-report dialog + export libs load when the user opens that feature.

**Recommended**

| Pri | Fix |
|---|---|
| P0 | Stop desktop auto-prefetch. Keep first page (100) + explicit «تحميل المزيد». **Applied.** |
| P0 | Lazy-mount `OrdersAnalytics` and `ModeratorDailyReportDialog`; dynamic-import html2canvas/xlsx on export. **Applied.** |
| P1 | Virtualize the list (`@tanstack/react-virtual` or window the cards). |
| P1 | Product filter must apply the same date window; never scan all `order_items`. |
| P2 | Split the 4k-line page into list / filters / dialogs so a status click does not re-render analytics. |

---

### 2. P0 — Realtime refetch storms on every order/item change

**Why it feels slow during the workday.** A new order writes 1 `orders` row + N `order_items` rows. Several screens subscribe to `event: "*"` on **both** tables and refetch **everything**.

**Evidence**

| Location | What happens on each change |
|---|---|
| `src/pages/modules/warehouse/WarehouseDetail.tsx` | `fetchAll()` — warehouses, all items, 500 movements, 2000 order_items join, 2000 outlet orders with nested items |
| `src/components/sales/ModeratorQuickAccessCards.tsx` | invalidate → reload **all month orders** + paged items |
| `src/components/sales/GirlsSalesQuantityTable.tsx` | same, plus `chick_orders`; `refetchInterval: 60s` |
| `src/components/sales/ModeratorsAggregateSummary.tsx` | all month orders + items |
| `src/components/sales/ModeratorPayrollTable.tsx` | orders + items + chicks |
| `src/components/dashboard/OrdersBySourceCard.tsx` | refetch today-by-source |
| `src/hooks/useExecutiveApprovals.tsx` | 11-table `Promise.all` every 30s **and** on 11 realtime channels; mounted from the **sidebar** for GMs |
| `src/components/layout/DashboardLayout.tsx` | always-on: notifications, reminders, presence, internal-message realtime |

`useExecutiveApprovals` also builds a **new channel name every mount** (`Date.now()` + random), so a sidebar remount leaks extra subscriptions.

**Recommended**

| Pri | Fix |
|---|---|
| P0 | Debounce warehouse/detail refetch (800ms–1.5s). **Applied in this PR.** |
| P0 | Debounce + `refetchInterval` only for sales cards; do not invalidate on every `order_items` INSERT. |
| P1 | Stable channel names; one shared “orders changed” bus with 2s coalesce. |
| P1 | Sidebar approvals: poll 60–120s, drop per-table realtime or listen to a single `executive_approvals` view. |

---

### 3. P0 — Dashboard / GM home over-fetches a year of rows in the browser

**Why the home screen stutters.** Role landing `/` (`Index`) runs several independent full-table aggregations:

1. `useReportsData("year")` — up to 40 pages × 1000 orders for the Cairo year, then **all `order_items` in chunks of 200**.
2. `useDashboardStats` → RPC `get_dashboard_overview()` which `SUM`/`COUNT`s **the entire `orders` table** (`WHERE status <> 'cancelled'`) plus `COUNT(*)` customers and low-stock products. Full scan on every load and every 2 minutes.
3. `DailyRegistrationsTable` — paginates **all current-month orders**, `staleTime: 0`, `refetchOnMount: "always"`, `refetchOnWindowFocus: true`, `refetchInterval: 60s`.
4. `useTodayOrdersBreakdown` + `useRecentOrders` + production stats on top.

`App.tsx` default QueryClient: `staleTime: 30_000` + `refetchOnWindowFocus: true`. Switching WhatsApp → browser retriggers every stale query.

**Evidence**

- `src/pages/Index.tsx` line `useReportsData("year")`
- `src/hooks/useReportsData.tsx` (`PAGE_SIZE = 1000`, `MAX_PAGES = 40`)
- `src/hooks/useSalesAnalytics.tsx` (`useMonthlySalesFromDB` still selects `total, created_at` with **no date limit** — unused on Index but live landmine)
- `supabase/migrations/20260520062204_0577f2f7-d187-4b19-b4ef-ea81d28e986e.sql` — `get_dashboard_overview`
- `src/components/dashboard/DailyRegistrationsTable.tsx`

**Recommended**

| Pri | Fix |
|---|---|
| P0 | Dashboard charts should use an RPC (like `get_dashboard_overview` monthly JSON) — **do not download the year**. |
| P0 | `DailyRegistrationsTable`: `staleTime ≥ 2min`, drop the 60s interval, or reuse the RPC daily JSON. |
| P1 | Confirm index on `orders (created_at)` and `(status, created_at)`. The lifetime `SUM(total)` in the RPC should be a materialized counter. |
| P2 | `staleTime` default 2–5 min; `refetchOnWindowFocus` only for a short allow-list. |

---

### 4. P0 — Giant JS on first load and on Orders / Warehouses navigation

Already measured above. Extra source patterns:

- Static `import * as XLSX from "xlsx"` in 40+ pages/components (export-only).
- Static `exceljs` on the Orders Excel path.
- `Warehouses.tsx` always mounts `WarehousesDashboardPanel` (recharts).
- No Vite `manualChunks` before this PR.

**Applied here (safe):** lazy-import exceljs/xlsx/html2canvas on export click; split those libs in `vite.config.ts`; lazy-mount `WarehousesDashboardPanel`, `OrdersAnalytics`, and `ModeratorDailyReportDialog` off hub navigation.

**Still P1**

- Dynamic-import `xlsx` inside the remaining 40 files the same way (`src/lib/safeExcel.ts` is a good template). Those pages are not on warehouse/orders hub navigation.

---

### 5. P1 — Warehouses hub loads every table on open

`src/pages/modules/Warehouses.tsx` `fetchAll()` (on mount and after every mutation):

```
warehouses.select(*)
inventory_items.select(*, warehouse, product)   // no limit
slaughter_batch_outputs … limit 300
orders last 30 days limit 1000
then for EACH warehouse:
  inventory_movements.select(*, item, warehouse, destination) limit 200
```

That is an **N+1 movements query**. A supervisor with 8–12 warehouses pays 8–12 heavy joins before the first tab paints. `select *` on items pulls unused barcode/cost/product columns.

`WarehouseDetail` additionally joins 2000 `order_items!inner(orders, customers)` and 2000 outlet orders **with nested `order_items`**.

**Recommended**

| Pri | Fix |
|---|---|
| P1 | Fetch only the active tab. Movements: one query `in(warehouse_id, ids)` + `limit`, not per-warehouse. |
| P1 | Narrow `select` to columns the UI reads. |
| P1 | Outlet orders: `limit 100` + date window; demand calc should be an RPC, not 2000 joined items. |

---

### 6. P1 — Client N+1 and wide `select *`

Examples (not exhaustive):

- `src/pages/Customers.tsx` — `customers.select('*')`
- `src/pages/NewOrder.tsx` — all active products + all offer boxes on open (acceptable size today; watch growth)
- `src/pages/Orders.tsx` — after each page, lookup profiles / products / warehouses / routes (batched — OK)
- Product-filter path: one `order_items` scan + chunked `orders` + chunked `order_items` again

Supabase MCP was not bound to this project in the agent environment (`list_projects` = []), so **index health was not verified live**. Treat missing `(created_at)`, `(status, created_at)`, `order_items(order_id)`, `order_items(product_name)` as P1 DBA work.

---

### 7. P2 — Shell tax on every page

Every authenticated page mounts `DashboardLayout`:

- `useOrderNotifications`, `useDailyReminders`, `useInternalMessageRealtime`, `useUserPresence`
- Sidebar: unread notifications + internal messages + mandatory messages + executive approvals
- `framer-motion` `AnimatePresence` around all routes
- Boot: `main.tsx` waits on `/version.json` (2.5s timeout) before rendering `App`

Not the main “بطيء بالعمل” story, but it adds JS parse + extra sockets on low-end phones.

---

## What this PR changes (P0 read-path only — no data writes/deletes)

1. **Defer Excel libraries until export click** + Vite `manualChunks` for exceljs/xlsx/jspdf/html2canvas/recharts/framer-motion
2. **Debounce `WarehouseDetail` realtime `fetchAll` to 800ms**
3. **`useDeferredEnable` (2s / idle)** on `useExecutiveApprovals`, `useLabTreasuryApprovals`, `MegaDiscrepancyAlert`, `DuplicateApprovalsAlert` — treasury/discrepancy REST no longer starts on warehouse/orders first paint
4. **`DiscrepancyBanner`** uses `useAuth` roles (no second `/user_roles` fetch)
5. **Warehouses hub:** lazy-import treasury / stock / reports / recharts dashboard; `fetchAll` paints after warehouses+items, then loads movements/slaughter/geo orders; narrower `select`; movements 80/warehouse; recent orders cap 200
6. **Orders:** first page only (desktop no longer background-loads the whole month); product catalog and Agouza reservations start after 1.5–2s
7. **Orders JS critical path:** `OrdersAnalytics` (recharts) and `ModeratorDailyReportDialog` are `lazy()` + Suspense; html2canvas/xlsx load only on image/Excel download inside that dialog

«تحميل المزيد» still pages the rest of the month. Opening the treasury sub-tool still loads that tab’s data. Approval badges appear ~2s later.

---

## Deferred to P1 (needs Supabase owner)

- Indexes: `orders(created_at)`, `order_items(order_id)`, `agouza_stock_reservations(order_id)`, `order_mega_discrepancies(status, created_at)`
- Virtualize the Orders card list
- Dynamic-import `xlsx` on remaining non-hub pages (~40 files)
- Dashboard year aggregation via RPC (stop downloading the year)
- Debounce sales-card realtime invalidation
- RLS cost on `profiles` / `user_roles` (5.8s even for a single-row `eq id`)

Keep production build green. Do not merge until the coordinator re-measures Network on preview.
