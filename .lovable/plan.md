## Dispatch E — Factory Dashboards, Reports & Printable PDFs

Frontend-first build. No RLS changes, no service_role exposure, no movement bypass. BOM v1 preserved, BOM v2 not auto-activated, invoice 164 stays `needs_review`. Test data (TEST-DISPATCH-D4) is **preserved**, never deleted — only filtered out of default operational KPIs.

### A) Test-data handling

- Introduce a shared client-side `useTestDataFilter()` hook + `<TestDataToggle/>` control.
- Default: dashboards/reports query with `audit_reason NOT LIKE 'TEST-DISPATCH%'` and `batch.notes NOT LIKE 'TEST-DISPATCH%'` (or equivalent metadata filter on `meat_factory_batches` / `feed_batches` / `inventory_movements.reference_note`).
- Admin/Manager (`useAuth().roles`) sees the toggle; Production/Warehouse roles cannot enable test view.
- Reversal note: surfaced as documentation in dashboard footer ("Adjustments must go through inventory_movements only").

### B) Meat Factory Dashboard — `/meat-factory/dashboard`

- KPIs (cards via existing `StatCard`): today/monthly production qty, batches by status (draft, under_review, approved, closed, cancelled), raw consumption, packaging consumption, finished goods received, total cost, avg cost/kg, waste qty + %, shortage/zero-cost/missing-barcode/pending-review counters.
- Charts (Recharts): production-by-product (Bar), cost-per-product (Bar), raw-material trend (Line, 30d), waste trend (Line, 30d), batch status (Pie), top-10 consumed raw (Bar).
- Data via small focused RPCs (read-only, SECURITY DEFINER with role guards): `dash_meat_kpis(p_from, p_to, p_include_test)`, `dash_meat_charts(...)`.

### C) Feed Factory Dashboard — `/feed-factory/dashboard`

- KPIs: today/monthly feed production, production by feed type, batches by status, raw consumption, finished feed received, total cost, avg cost/kg, shortage/zero-cost/pending review, **invoice 164 needs_review** persistent alert card.
- Charts: production-by-type, cost/kg, raw trend, batch status, top-10 feed materials.
- Data via `dash_feed_kpis(...)`, `dash_feed_charts(...)`.

### D) Combined Factory Overview — `/factories/overview`

- KPIs: total production value, raw value consumed, finished value received, batches closed, pending approval, review issues, inventory valuation, cost alerts, operational blockers.
- Pulls from both factory RPCs + `inventory_movements` aggregates.

### E) Reports — `/factories/reports` (tabbed)

Tabs, each with filter bar (date range, factory, product/feed, status, warehouse, include-test toggle, search) and CSV export via `src/lib/safeExcel.ts`:

1. Production Batch Report
2. Raw Material Consumption Report
3. Packaging Consumption Report
4. Inventory Movement Report
5. Cost Analysis Report (planned vs actual, variance)
6. Pending Review Report (missing barcode, zero cost, negative stock, packaging conflicts, **invoice 164**, unresolved issues)

Backed by read-only RPCs `rep_*` returning tabular JSON; pagination by 1000.

### F) Printable PDF reports

- Use existing `jspdf` + `jspdf-autotable` (already in deps; verify, install if missing).
- Helpers: `src/utils/exportMeatBatchPDF.ts`, `src/utils/exportFeedBatchPDF.ts`.
- Header: "نعم العاصمة — Na'am Al-Asimah" + factory name + batch # + status; sections for materials, packaging, costs, waste, movements, audit notes, signatures (prepared/approved/closed), print timestamp.
- Print button wired into `MeatBatchDetail.tsx` and `FeedBatchDetail.tsx`.

### G) UI

- Arabic-first (RTL), brand purple/orange, Framer page transition.
- Filter bar component reused across dashboards & reports.
- Drill-down: row click → batch detail or movement detail dialog.
- Alert cards for blockers (shortage / zero-cost / missing barcode / invoice 164).

### H) Security

- New RPCs: `SECURITY DEFINER`, `SET search_path = public`, guarded by `has_role(auth.uid(), ...)` for Admin/Manager/Accountant; production roles get qty-only view (no cost) via dedicated function.
- No table grants changed; RLS untouched; anon blocked (RPC `RAISE` on missing auth).
- No client-side service_role; UI never writes to stock — only via existing `inv_*` / `fd_*` RPCs.

### I) Routes summary

- `/meat-factory/dashboard` (new)
- `/feed-factory/dashboard` (new)
- `/factories/overview` (new)
- `/factories/reports` (new, tabbed)
- `MeatBatchDetail` / `FeedBatchDetail` — add Print PDF button
- Sidebar entries under existing Meat/Feed sections + Executive group

### Verification

- After build, exec a script to generate sample PDFs for the two TEST-DISPATCH-D4 batches (`643b69ee…` meat, `0bf18d11…` feed), QA via `pdftoppm` inspection, and attach as artifacts to the final report.
- Run targeted SQL counts confirming default KPIs exclude test data and toggled view includes them.

### Out of scope (deferred to Dispatch F)

- Marking modules "production-ready".
- Email/scheduled report delivery.
- Mobile-optimized dashboard variants beyond responsive grid.
