---
name: Zodex Sync Rules (LOCKED)
description: Locked rules for Zodex integration — bill matching, price tolerance, product aliases, auto-confirm, returns sync
type: feature
---

# Zodex Sync — Locked Rules

## Bill matching (`src/lib/zodexClassify.ts`)
- Price difference of **exactly 110 EGP** between Zodex bill and internal order = **valid match** (accounts for Zodex shipping fee that isn't transferred to us).
- Zodex never remits shipping money; we only use Zodex to detect what was registered externally but missing internally so girls can register it.
- Linked bills MUST never appear in the "Missing" list on `/modules/warehouses/zodex-review`.

## Product aliases (`src/lib/bosttaDeliveryParser.ts`)
- "بيض" and "دبوس بالعضم" are recognized aliases — do NOT re-flag as unknown products.

## Auto-confirm Bostta sheets
- If every row in a Bostta sheet matches a known customer/product, auto-confirm delivery without manual review.
- Do not add friction/warnings back for these cases.

## Returns sync (`supabase/functions/sync-zodex-shipments/index.ts`)
- Poll `shippings.php?action=filter&items=1000` and detect return statuses via regex: مرتجع | مرفوض | ملغى.
- For linked bills flagged as return on Zodex:
  - Set internal `orders.status = 'cancelled'`
  - Append note: "مرتجع من زودكس - <zodex status>"
  - For Agouza orders: call `release_agouza_stock_reservation` (fk reservations only; no inventory movement).
- Sync toast must include count of processed returns.

## CPU/resource limits
- Edge function `sync-zodex-shipments` must keep page limits and lookback windows small to avoid WORKER_RESOURCE_LIMIT (546). Do not re-expand.
