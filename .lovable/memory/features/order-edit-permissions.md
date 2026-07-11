---
name: Order Edit Permissions (LOCKED)
description: Who can edit order data (customer info & products) based on order status
type: feature
---

# Order Edit Permissions — LOCKED

Applies to `src/pages/OrderDetails.tsx` and `src/pages/Orders.tsx`.

- **Pending order** (`status = 'pending'`): Moderators CAN edit customer data and products of their own orders.
- **Delivered or Cancelled**: editing is LOCKED to General Manager & Executive Manager only.
- Do not loosen these restrictions for other roles.
