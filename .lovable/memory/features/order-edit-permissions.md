---
name: Order Edit Permissions (LOCKED)
description: Who can edit order data (customer info & products) based on order status
type: feature
---

# Order Edit Permissions — LOCKED

Applies to `src/pages/OrderDetails.tsx` and `src/pages/Orders.tsx`.

- **Customer data (name/phone/address)**: ALWAYS editable — even after delivered/cancelled/returned — by GM, Exec, sales manager, marketing manager, and moderators (own orders). Never hide the "تعديل بيانات العميل" button.
- **Products (items)**: Moderators CAN edit only while the order is `pending`. After delivered or cancelled, product editing is limited to General Manager & Executive Manager.
- **Offers**: an order's offer tag must stay visible after edits; item edit dialog exposes a per-row "العرض / البوكس" selector, and new rows inherit the order's offer. Swapping to a box is allowed even when the order has no offer (plain products can be replaced by a box).

