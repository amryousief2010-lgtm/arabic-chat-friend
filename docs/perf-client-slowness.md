# لماذا التطبيق بطيء؟ — تشخيص أداء الواجهة

تاريخ القياس: 19 سبتمبر 2026  
الهدف: تقرير أسباب مرتّب حسب الأثر، وليس إعادة هيكلة كبيرة.  
الإنتاج المقاس: `https://coceg.net` (deployment `f6c0cc03-…`)

---

## ملخص عربي للمنسّق / مالك المنتج

التطبيق مش «بطيء في السيرفر» قد ما هو **بيحمّل بيانات كتير جدًا على جهاز المستخدم ويعيد تحميلها مع كل حركة**.

أهم 5 أسباب:

1. **شاشة الطلبات بتجيب الشهر كله على الديسكتوب** وتعرض كل صف ككارت ثقيل من غير ترقيم حقيقي. أي فلتر منتج يمسح جدول بنود الطلبات كامل (~12 ألف طلب مذكور في الكود).
2. **كل طلب جديد يعيد تحميل شاشات كاملة** (مخزن / بطاقات المسوقات / لوحة المدير) لأن الاشتراك اللحظي على جدولي `orders` و `order_items` بيشغّل جلب ضخم من غير تهدئة.
3. **لوحة التحكم بتجيب مبيعات السنة كلها على المتصفح** (آلاف الطلبات + كل أصنافها) وفي نفس الوقت دالة قاعدة بيانات بتعمل مسح لكل الطلبات.
4. **ملف الجافاسكريبت الأول 2 ميجا** قبل الضغط، ومكتبات التصدير (Excel ~917 كيلو) بتتحمّل مع فتح الشاشة مش عند الضغط على الزر.
5. **شاشة المخازن بتجيب كل الأصناف وكل الحركات** (استعلام لكل مخزن) حتى لو المستخدم فاتح تاب واحد.

اللي اتعمل في الـ PR ده: تشخيص + تعديلات صغيرة آمنة (تأجيل مكتبات Excel، وتقسيم الحزم، وتهدئة تحديث المخزن).  
اللي محتاج قرار منتج: وقف التحميل التلقائي لكل طلبات الشهر، وترقيم الجدول، ونقل تجميع السنة لسيرفر.

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
- `OrdersAnalytics` is **always mounted on desktop** (`showAnalytics` only gates mobile).
- `ModeratorDailyReportDialog` statically imports `html2canvas` + `xlsx` into the Orders module graph.

**Recommended**

| Pri | Fix |
|---|---|
| P0 | Stop desktop auto-prefetch. Keep first page (100) + explicit «تحميل المزيد». |
| P0 | Virtualize the list (`@tanstack/react-virtual` or window the cards). |
| P1 | Product filter must apply the same date window; never scan all `order_items`. |
| P1 | Lazy-mount `OrdersAnalytics` and `ModeratorDailyReportDialog`. |
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

**Applied here (safe):** lazy-import exceljs/xlsx on export click; split those libs in `vite.config.ts`.

**Still P1**

- Lazy-mount `WarehousesDashboardPanel` / `OrdersAnalytics` / `ModeratorDailyReportDialog`.
- Dynamic-import `xlsx` inside the remaining 40 files the same way (`src/lib/safeExcel.ts` is a good template).

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

## What this PR changes (small P0 only)

1. **Defer Excel libraries until export click**
   - `exportOrdersSheet.ts` — `import("exceljs")` inside the function
   - `exportOrders.ts` / `exportReports.ts` — `import("xlsx")` only in XLSX helpers
   - Orders / Index / Reports / dashboard dialogs / warehouse Excel buttons follow the same pattern
2. **`vite.config.ts` `manualChunks`** for exceljs, xlsx, jspdf, html2canvas/html2pdf, recharts, framer-motion
3. **Debounce `WarehouseDetail` realtime `fetchAll` to 800ms**

No query-window or pagination behavior was changed (that needs a product decision so moderators do not suddenly see “missing” month orders).

---

## Suggested next PRs (do not mix)

1. `perf: orders list stop desktop prefetch + virtualize`  
2. `perf: debounce sales realtime invalidation`  
3. `perf: dashboard year aggregation via RPC`  
4. `perf: warehouses fetch active tab only`

Keep production build green; do not merge this findings PR until the coordinator picks which P0 to implement next.
