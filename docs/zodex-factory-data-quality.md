# Zodex matching + factory data-quality (follow-up to PR #5)

PR #5 documented Zodex discrepancies and factory alerts as “probably data.” This pass starts from `main` (PRs **#3** and **#5** left unmerged) and separates **false-positive matching** from **real gaps**, with only small deterministic code changes.

Live GM snapshot that triggered the review: **1 Zodex waybill without a local order**, **3 local orders missing on Zodex**, **1 linkage issue**. Factory/feed cards: **32 / 9** «جودة بيانات».

## 1) Zodex review matching

### Root-cause map

| Live row | False-positive risk vs real gap | Files |
|---|---|---|
| 1 waybill, no local order | **Usually a real gap** (Zodex-only registration) *or* a scrape with a garbage phone so last-9 never hits. Previously the UI just said “orphan” with no why. | `src/pages/modules/warehouse/ZodexReview.tsx`, `src/lib/zodexClassify.ts` |
| 3 local orders, no Zodex bill | **Mix.** Criteria are Agouza / shipping_company~zodex / unclassified, older than 24h, not cancelled. Unclassified fulfillment is **expected noise**. Phone-only “موجود على زودكس” was a **false positive** (FIFO first bill, ignore amount). | same |
| 1 linkage issue | **Often a near-miss**, not a broken FK. Review scoring allowed 7-digit phone `ilike` + 30–160 EGP windows, then one-click “تأكيد الربط” at score ≥ 60 without a strong phone key. Sync auto-match ignored the locked **+110** shipping rule, so the same pair could sit unmatched in both tabs. | `zodexClassify.ts`, `supabase/functions/sync-zodex-deliveries/index.ts` |
| HTML scrape | **False-positive machine.** `get(8)` phone / `get(14)` date, and `parseZodexDate \|\| new Date()` made undated rows look “today,” then FIFO ±3 days could attach the wrong order. Unlink used exact 11-digit equality, so `01` vs `20` or a shifted column unlinked a valid bill. | `_shared/zodexSync.ts` `mapBalanceCells`, deliveries function |

### What changed (safe)

- Review match key is **last 9 digits** (not 7/8-digit `ilike`).
- Pending-bill suggestion requires last-9 **and** amount exact **or +110**. Phone-only is labeled, never treated as a match.
- One-click confirm / “إصلاح الربط” requires **phone closeness ≥ 0.85**. Weaker scores show as `weak_match`, manual relink only.
- Each orphan / no-bill row has a **سبب عدم المطابقة** (invalid phone, missing date, amount off, no last-9, unclassified warehouse).
- Scrape: never invent `now()` for a missing date; rescan only **pure phone** / parseable date cells; skip auto-match without a valid phone+date; unlink only when the scraped phone looks like `01…` and last-9 matches neither saved number.
- Sync auto-match amount key: ±5 EGP **or locked +110**. No 30–160 auto-link.

### Deferred (do not invent production links)

- Auto-linking from the review screen.
- FIFO when the same customer has several identical COD orders in ±3 days (product-signature tie-break stays as-is).
- Replacing HTML scrape with a Zodex JSON API (pipeline JSON is already used for a subset).
- Changing `rowInWindow` so undated shipment-list rows are skipped (still “never silently drop”).

## 2) Factory / feed «جودة بيانات» (32 / 9)

### How the numbers are computed

| Surface | Formula | Period filter? |
|---|---|---|
| Factory overview «مشاكل جودة بيانات» | `inventory_items` with `unit_cost === 0 && stock > 0` | **No.** Snapshot of current stock. Empty-month production does not clear it. |
| Feed «تكلفة صفرية» | Same, `module === "feed"` | **No.** |
| Reports tab `pending` | zero-cost, **plus** negative stock, missing barcode, **plus** a hardcoded Invoice 164 sentinel | **No.** So the tab count is **larger** than 32. |

32 vs 9 is **not double counting**: overview = meat + feed (+ previously warehouse SKUs); feed card = feed only. 32 − 9 ≈ meat (and formerly non-factory rows).

### Bug vs expected

- **Expected empty-month noise:** date filters on `FactoryFilters` apply to batches/movements, not `inventory_items`.
- **Clear filter bug (fixed):** items query was unfiltered `.limit(1000)`, so warehouse SKUs with cost 0 could inflate the factory card. Now `.in("module", ["meat","feed"])`.
- **Not a code bug:** Invoice 164 is a preserved `needs_review` sentinel (also a banner on the feed dashboard). It is **not** part of the 32/9 KPI; the pending tab now labels it as a note.
- **Not double counting:** one SKU can appear twice on the pending tab (zero cost **and** missing barcode). KPI still counts the SKU once.

## 3) Private courier / hatchery skim

No Critical route/role mismatch of the warehouses-hub kind.

- `/hatchery` → `/modules/hatchery` (same destination). Extra hatchery tools (import, statements) have broader role lists on purpose.
- `/delivery-routes` still allows `private_delivery_rep`; sidebar item is commented in favor of `/private-courier/*`. Planning/routes **exclude** the courier by `allowedRoles` (ops vs field). Prefix `/private-courier` lets a rep open the dashboard + «طلباتي». Dashboard still *shows* planning links they cannot open — UX, not a landing-loop bug. Deferred.

## Out of scope

- PRs #3 and #5 (untouched).
- Warehouse manual-stock SQL / Phases 1–3.
- Secrets / Zodex credentials.
- Auto-linking production orders.
