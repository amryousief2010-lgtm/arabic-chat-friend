# Zodex ⇄ coceg — automatic waybill linking, review queue and sync health (design)
Date: 27/10/2026 (Riyadh time) · Branch: feat/zodex-autolink-review · Status: draft PR 1, nothing applied to production

## 0. Goal and fixed decisions
- Waybills are linked automatically. م. آلاء only reviews: she confirms, rejects or picks another candidate. She does no manual entry and no manual pulling.
- Zodex itself is unchanged. coceg integrates from its side only (read, export, reconcile).
- Matching is by customer mobile. Any doubt goes to review.
- The coceg total is never overwritten by a Zodex amount. A difference is shown as a flag in `orders.zodex_amount_diff`.
- Access is by role (`zodex_can_review()`: general_manager, executive_manager, sales_manager, marketing_sales_manager), not by user id.

## 1. Pipeline (what is actually possible with Zodex)
Live read-only probe, 27/10 00:5x Riyadh time, using the same flow as `sync-zodex-shipments`:
- `GET /admin-area/login.php` returns 200. It is a plain form (email, password, remember-me, authorize) with no captcha and no CSRF token. The only session cookie is `PHPSESSID` (a session cookie with no expiry).
- `POST login.php` returns 200 with a JSON body: `{"type":"failed","message":"User Not Found"}`. The username provided is an 11-digit number, but the form field is **email**. Zodex does not recognise this value as an account e-mail.
- Every protected page (index.php, shippings.php) answers 302 to login.php when there is no session. This explains every sync failure since 25/10: it is a credential/account problem, not a code bug.
- One TLS connection reset happened on a retry, so the site is intermittently flaky. Retry with backoff is required.
- No API or export endpoint was found in the code or on the page. Recommendation: Amr asks Zodex for a read-only API key or a scheduled CSV/Excel export. That is a request, not a change to Zodex.

Therefore an **HTTP-only pull is feasible, with no browser needed**. Login is a plain form POST with a cookie jar. Pages are server-rendered HTML tables (`shippings.php?items=N&page=P`) parsed by regex. The fields available per waybill come from the existing parser: bill_no (ZX…), mobile 1/2, COD amount, status text, receiver name, creation date, last-status-change date. The page-size limit and session lifetime could not be measured because login failed; I will re-measure once the credentials work (probe script ready).

Hardening (PR 2):
1. **Session health check**: after login, assert that index.php returns 200 and does not render the login form. Keep the JSON `message` from the POST and store it as `error_message` (for example "User Not Found"), never the credentials.
2. **Retry/backoff**: 3 tries at 2s, 8s and 30s on network errors. **No retry on "User Not Found" or wrong password**, to avoid locking the account.
3. **Paging past 400**: loop over pages until a page returns fewer rows than `items`, or until it reaches bills older than the window. Hard ceiling of 60 pages; record pages_fetched.
4. **Hung-run reaper**: wrap the run in try/finally that always sets finished_at. A cron job marks `running` rows older than 15 minutes as `failed (timeout)`. This is the root of the 181+ hung runs; deliveries-sync has no finally block.
5. **Distinct states**: `zodex_sync_health` and the panel distinguish "تعذّر الدخول إلى زودكس" (login failed after the last data) from "يعمل — توجد بوالص للمراجعة" and from "متأخر" (no data for more than 2 hours).
6. **Cron consolidation**: from 7 jobs down to 2. One is shipments+deliveries every 30 minutes with a single login; the other is a nightly full 45-day review.

## 2. Matching engine (`supabase/functions/_shared/zodexMatchEngine.ts`, pure, deterministic, versioned `zx-match-1`)
Evidence and points:
- Mobile exact: 50. Last 9 digits: 40. No match: the candidate is dropped.
- Amount exact: 30. Total + 110 shipping: 28. Within ±5: 25. Mismatch: 0, with the difference recorded.
- Shipping date 0–3 days after the order: 20. 4–10 days: 8. More than 10 days: 0.
- Blockers:
  - ship date more than 25 days after the order (month guard), or before the order;
  - pickup or cancelled order;
  - order already holds another waybill;
  - waybill already on another order, or on more than one order.

Tiers:
- **AUTO**: exactly one open candidate (or one whose amount clearly beats the rest by at least 25 points), exact mobile, amount OK, date close, score ≥ 85, no blocker.
- **REVIEW**: several candidates, an amount difference, a wide date gap, or only a partial mobile match. It always carries the suggested best order and the reasons in Arabic.
- **BLOCKED**: every candidate has a blocker, the waybill is on several orders, or there is no mobile.
- **NO_ORDER**: no coceg order on that mobile.

Other parts of the engine:
- `auditExistingLink` re-checks existing links and returns amount_diff, wrong_month, shared_mobile, bill_multi_order, order_multi_bill and mobile_mismatch.
- Status updates are guarded (`guardedStatusUpdate`). They happen only on AUTO or already-confirmed links, and only for pending→delivered and pending→cancelled (returned or cancelled). A flip between delivered and cancelled always goes to review.

## 3. Data model (migration `20261027090000_zodex_autolink_review_queue.sql`: additive only, NOT applied)
- `orders.zodex_cod_amount` and `orders.zodex_amount_diff` are informational. `orders.total` is never touched.
- `zodex_link_queue` holds one open row per waybill: tier, suggested order, score, reasons, candidates with evidence, run_id, state (open/auto_linked/confirmed/rejected/undone).
- Row-level security gives read access to the review/warehouse/finance roles. Writes happen only through the service role or the RPCs below.
- `zodex_review_decide(queue_id, confirm|reject, order_id?)` is atomic under a row lock. It re-checks for duplicates, writes an audit row to `zodex_bill_link_audit`, and is idempotent.
- `zodex_review_bulk_confirm(ids[])` works on AUTO rows only and reports per-row errors.
- `zodex_link_undo(queue_id)` unlinks, writes an audit row, and re-opens the waybill as REVIEW so it is never silently lost.
- `zodex_sync_health` is a view with no PII that feeds the status panel.
- Rollback SQL is included at the bottom of the migration.

## 4. Review UI (`/modules/warehouses/zodex-autolink`)
- Status panel at the top.
- Five counter cards (يحتاج مراجعة / متعارض — موقوف / ربط قديم مشكوك فيه / بوليصة بدون أوردر / ربط تلقائي مؤكَّد).
- Each row shows the order number, waybill number, Zodex amount with the difference highlighted, shipping date, and the reasons in Arabic.
- Actions are تأكيد / رفض / a candidate picker / تراجع. Bulk-confirm works on the AUTO tier only.
- Search by order or waybill number, an "amount difference only" filter, a "show reviewed" toggle, and CSV export with a UTF-8 BOM so Excel shows Arabic correctly.
- Logo colours #A4288A, #F37346 and #662D8C; golden-ratio cards (aspect 1.618) and panel split.
- Viewers without a decide role see the page read-only.

## 5. Audit, reports
- Every decision, auto-link and undo is recorded in `zodex_bill_link_audit` (match_reason = `auto|review_confirm|undo:zx-match-1`) and in the queue row (decided_by/at).
- Daily health summary (PR 2) at 08:00 Riyadh time: the last data time, failures, hung runs, and counts per tier.
- Reconciliation report: delivered but not collected, amount differences, and returns without an amount.

## 6. Dry run (read-only, last 45 days, run 27/10 00:51 Riyadh time)
The input is 1,347 orders that currently have a waybill. Phones were md5-hashed in SQL, and the output contains counts and order numbers only. Zodex amounts are not stored in coceg, so the audit `match_reason` stands in for the amount (phone_and_cod means a match).

| Tier | Count |
|---|---|
| AUTO | 519 |
| REVIEW | 358 |
| BLOCKED | 470 |

852 existing links are flagged as suspicious:

| Reason | Count |
|---|---|
| amount difference | 408 |
| pickup order with a waybill | 367 |
| cancelled order with a waybill | 160 |
| shared mobile | 92 |
| order with more than one waybill | 7 |
| waybill on more than one order | 3 |

Full output: `/workspace/capital/zodex_dryrun_20261027.json`. These numbers will shrink once the live run has the real Zodex COD and dates.

## 7. Later PRs (in order)
| # | PR | Risk | Effort |
|---|---|---|---|
| 2 | Sync hardening: try/finally + reaper, retry/backoff without retry on auth errors, paging, 7→2 cron jobs, the sync fills `zodex_link_queue` and auto-links the AUTO tier | Medium (cron change) | 1.5–2 days |
| 3 | Batched deliveries sync driven by the guarded status map. Remove hard-coded user ids (`sync-zodex-deliveries` L30, `MegaDiscrepancyAlert`, `useExecutiveApprovals`, `set_order_waybill_manual`) and use roles instead | Medium | 1–1.5 days |
| 4 | One secure manual-link path: RelinkBillDialog, LinkBillToOrderDialog and EditAddress all call `zodex_review_decide` / the RPC. Stop `process-bostta-delivery` overwriting `total` | Medium-high (touches money) | 1 day |
| 5 | Data cleanup scripts for the 852 suspicious links, the 4 multi-order waybills and the 9 multi-waybill orders. Full backup tables, dry-run then apply, rollback script | High (production writes; needs Amr's approval per batch) | 1 day + review |

## Revision zx-match-2 (27/10/2026, after Alaa's answers)

**Root cause of the 19 "not found" waybills:** 15 were in the last good sync's link_failures (`no_matching_phone`, 0 candidates). Each one had an open order on the same mobile, but that order was **pickup** or a **private courier** («مندوب خاص»), and `isExpectedZodexShipment` excludes both. The other 4 (…410/414/418/424) were created after sync stopped on 25/10 20:10 (Riyadh time, UTC+3) because the login broke. The delivery sheet only matches `shipping_bill_no`, so the 59 delivered rows were waybills the sync had already linked. Everything else was listed as "not found".

**Rules:**
- **Matching:** by mobile only.
- **Amount:** informational. It never decides or downgrades a match.
- **Guards:**
  - the waybill date must not be before the order;
  - the order must be at most 25 days old (month window);
  - one waybill per order, and one order per waybill;
  - never a cancelled order.
- **Pickup and private-courier orders:** eligible (the sync fix is in PR 2).
- **AUTO:** exactly one open order, with a date gap of 10 days or less.
- **REVIEW:** several open orders (the suggestion is the closest date), or a far date.

**Automatic paths:**
- **Sync and delivery sheet:** a waybill that is not yet linked is resolved by mobile through `resolveSheetRows`. The result is auto_link, review or not_found. not_found goes to `zodex_unmatched_bills`.
- **Reverse matching:** `reverseMatch` runs on a new order and on a 15-minute sweep.
- **Returns and cancellations:** `planStatusUpdates` produces a plan in `zodex_status_plan`:
  - pending → cancelled when Zodex says returned or cancelled, and the link is confident;
  - anything else goes to review.

  Apply and undo are bulk, per batch, with a guard that the status has not changed.

**Dry-run v2 (read-only, 45 days):**
- Existing links: AUTO 1187, BLOCKED 160. The 160 are cancelled orders that hold waybills, which matches returns. 99 links are flagged suspicious: shared mobile 92, waybill on many orders 3, order with many waybills 7.
- Unlinked waybills from the last run: 28. AUTO 22, BLOCKED 5, NO_ORDER 1.
