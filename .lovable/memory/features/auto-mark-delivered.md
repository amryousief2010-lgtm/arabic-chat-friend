---
name: Auto-mark orders as delivered
description: Two workflows auto-set orders.status='delivered' + payment_status='paid' + collection_status='collected' + delivered_at/collected_at=now()
type: feature
---

قاعدة دايمة (لا تسألني عنها):

**١) توريد يوم كامل لكيمو (المخزن الرئيسي) عبر `CourierOrderCustodyTab`:**
- عند نجاح `depositDayCash` (RPC `deposit_courier_day_cash`) → لكل `orders.id` في أوردرات اليوم:
  - `status = 'delivered'`
  - `delivered_at = now()`
  - `payment_status = 'paid'`
  - `collection_status = 'collected'`
  - `collected_at = now()`
- تتخطى الأوردرات اللي حالتها بالفعل `delivered` (`.neq("status","delivered")`).

**٢) توريد كشف بُسطة على مخزن العجوزة عبر `depositBosttaSheet`:**
- بعد نجاح إدخال الحركة في `agouza_warehouse_treasury_txns` → كل الأوردرات في `upload.orderNumbers` تتحدّث لنفس الحقول أعلاه (باستخدام `.in("order_number", ...)`).

**سبب القاعدة:** لما المندوب يورّد فلوس يوم كامل أو لما كشف الشحن يتوّرد على العجوزة، ده يعني الأوردرات اتسلّمت للعملاء وخلاص. مش لازم يحدّث المستخدم يدوياً كل مرة.

**الملف:** `src/components/warehouses/CourierOrderCustodyTab.tsx` — دوال `depositDayCash` و `depositBosttaSheet`.
