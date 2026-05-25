# Feed Factory — Professional Upgrade Plan

The Feed Factory module already has a rich foundation (products, raw materials, recipes with versioning + `is_packaging` flag, invoice batches with auto-computed `unit_cost_calc` and variance, QC checks, cost reviews, material issues with stock deduction, finished-goods moves, audit log, role helpers). This plan closes the remaining professional gaps without rebuilding what exists.

## 1. Database (single migration)

**Extend `feed_invoice_batches`** — add the accountant-final costing fields, mirroring the meat module:
- `other_expenses numeric(14,4) default 0`
- `byproduct_value numeric(14,4) default 0`
- `packaging_cost numeric(14,4) default 0` (auto-derived from `is_packaging` consumption)
- `approved_output_qty numeric(14,3)`
- `final_unit_cost numeric(14,4)`
- `cost_approved_by uuid`, `cost_approved_at timestamptz`
- `posted_to_inventory boolean default false`, `posted_at timestamptz`
- `destination_warehouse text`
- `needs_review boolean default false`, `review_reason text` (for invoice 164 quantity variance)

**Update trigger `feed_invoice_batch_compute()`**:
- Split `input_cost` into nutritional vs packaging using `feed_recipe_items.is_packaging`.
- Auto-flag `needs_review = true` when `output_qty_kg > input_qty_weight_kg * 1.02` (quantity variance > 2%).

**New RPCs (SECURITY DEFINER, search_path=public)**:
- `recompute_feed_batch_cost(p_batch uuid)` → `(materials + operating_cost + other_expenses + packaging_cost − byproduct_value) / approved_output_qty`. Restricted to feed managers + cost accounting.
- `approve_feed_batch_cost(p_batch uuid, p_final_qty numeric, p_destination text, p_notes text)` → requires QC `passed`, writes `feed_cost_reviews`, sets `cost_approved_*`, inserts `feed_finished_goods_moves` (movement `in`) and bumps `feed_products.current_stock`, marks `posted_to_inventory`. Restricted to `accountant`, `financial_manager`, `executive_manager`, `general_manager`.
- `feed_post_finished_to_destination(p_batch uuid, p_destination text, p_qty numeric)` for later farm/cost-center issues.

**Negative-stock guard**: extend the existing `feed_apply_issue()` trigger to log a `data_quality_tasks` row when a feed raw-material issue would push stock below zero (allow with warning, matching the meat pattern).

**RLS**: existing helpers `is_feed_team`, `can_manage_feed_recipes`, `can_approve_feed_qc`, `can_approve_feed_cost`, `can_issue_feed_materials` already cover the seven roles requested — confirm RPCs use them; no policy rewrite needed.

## 2. UI

**New components** (under `src/components/feed/`):
- `FeedCostApprovalPanel.tsx` — pending-batch list, edit final output qty, view variance & cost breakdown, "Approve & post to warehouse" action, destination selector. Mirrors `MeatCostApprovalPanel`.
- `FeedQualityReviewDialog.tsx` — pass / rework / reject with variance reason, writes `feed_qc_checks`.
- `FeedVarianceBanner.tsx` — yellow banner shown on batches where `needs_review = true`.

**Enhanced `feed/FeedDashboard.tsx`** — add KPI strip (avg cost/kg this month, total output, batches awaiting cost approval, low-stock raw materials), Recharts bar chart "cost per kg by product (last 30 days)", and "negative stock" + "recipes missing latest cost" tables.

**`FeedFactory.tsx`** — register two new tabs: "اعتماد التكاليف" (cost approval) and "مراقبة الجودة" (QC). Make the dashboard tab the default landing.

## 3. Invoice seeding (via existing ImportWizard, not a migration)

After the migration is approved I will document the import steps for the user:
- **Invoice 173** → latest fattening feed (علف تسمين) cost.
- **Invoice 167** → latest chick feed (علف كتاكيت) cost.
- **Invoice 164** → layer feed (علف بياض) — will be imported with `needs_review = true` because input vs output variance exceeds the 2% threshold.

I will **not** hard-code these invoices in SQL — they must flow through the staging → validation → post pipeline already built in `ImportWizard.tsx`.

## 4. Files

**Created**
- `supabase/migrations/<ts>_feed_factory_costing_v2.sql`
- `src/components/feed/FeedCostApprovalPanel.tsx`
- `src/components/feed/FeedQualityReviewDialog.tsx`
- `src/components/feed/FeedVarianceBanner.tsx`

**Modified**
- `src/pages/modules/FeedFactory.tsx` (new tabs, default tab)
- `src/pages/modules/feed/FeedDashboard.tsx` (KPIs + charts)
- `src/integrations/supabase/types.ts` (auto-regenerated)

## 5. Out of scope (per project rules)

- No public pages, no SEO/security loosening.
- No direct stock writes without QC → cost approval.
- No invoice data hard-coded in migrations.
- No changes to existing role / RLS model — only new RPCs reuse existing helpers.

## Questions before I start

1. Confirm the quantity-variance threshold for auto-flagging "needs review" should be **2% over input weight**, or do you want a different number (e.g. 1% or 5%)?
2. On cost approval, should finished feed always post to **"مخزن أعلاف وأدوية"** by default, or should the approver always pick a destination warehouse?
3. Should the cost approval be locked until QC `passed` is recorded (recommended), or do you want accounting to be able to approve cost even with QC `rework`?
