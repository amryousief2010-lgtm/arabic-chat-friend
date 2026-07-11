---
name: Agouza Order Cancel Flow (LOCKED)
description: How Agouza-sourced orders are cancelled and reservations released
type: feature
---

# Agouza Cancel Flow — LOCKED

Source of truth: `orders.status = 'cancelled'`. All status changes go through `updateOrderStatusShared` in `src/lib/orderStatusUpdate.ts`.

When an Agouza-sourced order is cancelled:
1. `orders.status='cancelled'` + append `[مرتجع - date] reason` to `notes`.
2. Call `release_agouza_stock_reservation(orderId, 'order_cancelled')` — releases the reservation row only.
3. **No `inventory_movements` are written** on cancel — stock was never deducted (deduction only happens on commit at delivery).
4. Set `update_status_marker='cancelled'` + updated_at/by for UI.
5. DB trigger writes to `order_status_audit`.

Cancel approval on cash handover: `approve_agouza_cash_handover` allows General & Executive Managers to bypass the self-approval restriction.
