# GM live audit — root-cause map (Sep 2026)

Live GM UI audit of the Naam Al-Asima ops app. Warehouse Phases 1–3 and sales PR #3 are untouched.

## 1. HIGH — `/reports` KPI cards stay skeletons; PDF/Excel disabled

**Root cause.** `useReportsData` treated *both* the orders query and the order-items query as blocking (`isLoading = orders.isLoading || items.isLoading`). The items query paginated `order_items` with an `orders!inner(created_at)` embed plus `.range()` and **no `.order()`**.

That combination is a known PostgREST failure mode: `.range()` can keep returning the same first 1000 rows, so `while (data.length === pageSize)` never exits. React Query’s `queryFn` never settles → `isLoading` stays true → skeletons + disabled export.

Default period was also `all` (since 2020), which maximized the chance of a hang.

`isError` was returned by the hook but ignored by `Reports.tsx`, so even a real error would look like “still loading” if the request never completed.

**Files.** `src/hooks/useReportsData.tsx`, `src/pages/Reports.tsx`, `src/lib/paginateQuery.ts`

**Fix applied.**
- Paginate orders with `.order(created_at, id)`, a max page cap, and stuck-page detection.
- Fetch items by `order_id` chunks from the orders already loaded (no embed+range).
- KPI / sales charts wait only on orders; product chart has its own skeleton.
- Default period is **هذا الشهر** (dashboard-aligned). `كل الفترات` still works.
- Surface query errors instead of swallowing them.

**How to verify.**
1. `npx vitest run src/lib/__tests__/paginateQuery.test.ts`
2. As GM, open `/reports`: KPI numbers appear; PDF/Excel enable after orders load.
3. Switch period to `كل الفترات`: page still settles (does not stay on skeletons).
4. Product chart may lag a moment behind KPIs; that is expected.

---

## 2. MEDIUM — `/orders` heading ~200 vs tab counts `(0)` including الكل

**Root cause.** Two different sources:

| UI | Source |
|---|---|
| Heading `قائمة الطلبات (N)` | `filteredOrders.length` from the **month-scoped, paginated list** (`restrictToCurrentMonthForFetch`) |
| Year tabs `الكل (N)` / 2026 / pre-2026 | Separate `select id { count: 'exact', head: true }` over **all** orders |

The HEAD counts are the expensive query the file already skips for sales moderators because they time out. For GM they still ran with **no timeout, no error handling**, and `count || 0`. A timeout / null count paints **(0)** on every year tab, including الكل, while the list heading shows the loaded month (~200).

Status chips (`الكل / قيد الانتظار / تم التوصيل / مرتجع`) had **no counts at all**, so they could not match the heading either.

**Files.** `src/pages/Orders.tsx`, `src/lib/orderYearCounts.ts`

**Fix applied.**
- 12s timeout on the HEAD counts.
- If remote count is null/error, fall back to counts from the **loaded list** (same rows as the heading).
- Show `…` only while both remote and list are empty.
- Status chips now count the same loaded rows (الكل matches the heading when no other filters hide rows).

**How to verify.**
1. `npx vitest run src/lib/__tests__/orderYearCounts.test.ts`
2. As GM, open `/orders`: heading N and status `الكل` N match.
3. Year tabs must not stay at `(0)` once any orders are visible. If the global HEAD count succeeds they show true all-time totals (larger than the month heading — that is correct).

---

## 3. MEDIUM — ~1000 unread, repeated manufacturing alerts per order

**Root cause.** Trigger `trg_notify_production_needed` (`supabase/migrations/20260513203153_70eee33b-712b-4c5f-ac9b-add98c72d8b6.sql`) fires **AFTER INSERT on every `order_items` row** when `quantity::int > products.stock`.

Dedupe only looked for an *unread* row whose description `LIKE` the product name. Offer boxes / multi-line orders therefore inserted **one alert per line**. Adding a new line (or re-inserting via `save_order_items_edit`) created more. There was **no unique constraint** and **no mark-read** when the order was delivered, cancelled, or returned.

Not a client status-poll loop — `useOrderNotifications` only listens; it does not insert.

**False positives in the trigger itself (not changed):** it compares against `products.stock` (global catalog), not warehouse `inventory_items` available qty, and `quantity::int` truncates fractions (0.5 kg vs stock 0 does *not* notify).

**Files.** `supabase/migrations/20260918203000_dedupe_production_needed_notifications.sql`, `src/lib/productionNeededNotifications.ts`

**Fix applied.**
- One unread `production_needed` row per `order_id` (partial unique index).
- Backfill: mark older unread duplicates read; keep newest per order.
- Mark remaining unread manufacturing alerts read when order status becomes `delivered` / `cancelled` / `returned`.

**Deferred.** Mass-deleting historical read duplicates; switching the stock check to warehouse available qty (product decision — would change who gets alerts); mark-read when `manufacturing_status` is completed (no product_id on the notification row).

**How to verify.**
1. `npx vitest run src/lib/__tests__/productionNeededNotifications.test.ts`
2. After migration: register an order with several over-stock lines → **one** unread `تنبيه: مطلوب تصنيع`.
3. Mark that order delivered → the manufacturing alert becomes read.

---

## 4. Ops data — Zodex discrepancies (document only)

These are primarily **data / matching** issues. Code paths that can create false positives:

| Mechanism | File | How it can false-positive |
|---|---|---|
| Match by phone + amount + moderator FIFO | `supabase/functions/sync-zodex-deliveries/index.ts` | Same customer, several orders in a month with the same COD → wrong order can get the ZX waybill |
| `parseZodexDate` missing → `new Date()` | same | Undated HTML rows look “new” |
| Undated rows never skipped | `supabase/functions/_shared/zodexSync.ts` `rowInWindow` | Intentional: never silently drop a row with no date |
| HTML column scrape (`get(8)` phone, `get(14)` date) | `sync-zodex-deliveries` | Zodex layout shift mis-parses columns |
| Unlink when Zodex phone matches neither saved phone | same | Third phone on the waybill unlinks a valid bill |
| Status flip to delivered from Zodex shipment status | same | Zodex “delivered” / closed invoice can mark our order delivered before ops confirms |
| `zodex_missing` notification per unmatched bill | same | Real missing bills *and* unmatched-due-to-phone-format both notify |

No warehouse SQL or stock changes. No code change in this PR.

---

## 5. Skim — factory data-quality alerts & HR stubs

**Factory overview `مشاكل جودة بيانات`.** Intentional wiring, not a bug.

- Count: `items` with `unit_cost === 0 && stock > 0` (`src/pages/factory/FactoryOverview.tsx`).
- Link: `/factories/reports?tab=pending` → `FactoryReports` alias map keeps `pending` as the tab key; pending rows are zero-cost, negative stock, missing barcode, plus a preserved “Invoice 164 needs_review” sentinel.

**HR `قريبًا`.** Intentional phase-2/3 stubs in `src/pages/hr/HRDashboard.tsx` (advances, attendance, payroll). Do not treat as broken navigation.

---

## Out of scope

- Warehouse stock / Phase 1–3
- Sales-metrics PR #3 (`applySalesNetFilter` / exclude cancelled)
- Changing `get_dashboard_overview` SQL
- Manual stock SQL
