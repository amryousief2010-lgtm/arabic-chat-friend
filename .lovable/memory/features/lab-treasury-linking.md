---
name: Lab Treasury Operational Linking
description: Auto-create pending treasury income from hatch payments + chick sales; source navigation; operational reports
type: feature
---
# ربط خزنة المعمل بالعمليات التشغيلية

## التدفق التلقائي (Server-side triggers)
عند الإدراج في الجداول التالية، تُنشأ حركة إيراد `status='pending'` في `lab_treasury_movements` مرتبطة بـ `source_table` + `source_id` + `source_ref`:

| مصدر | trigger | category |
|---|---|---|
| `hatch_customer_payments` | `lab_treasury_from_hatch_payment` | `hatching` |
| `hatchery_invoice_payments` | `lab_treasury_from_invoice_payment` | `hatching` |
| `brooding_chick_sales` | `lab_treasury_from_chick_sale` | `chick_sales` |

## منع التكرار
فهرس فريد `uq_lab_treasury_source` على `(source_table, source_id)` — كل صف مصدر يُنتج حركة واحدة فقط. التحصيلات الجزئية تُسجل كصفوف مستقلة في جدول المدفوعات → حركات منفصلة.

## payment_method
- أُضيف `payment_method text NOT NULL DEFAULT 'cash'` على `hatch_customer_payments`.
- دالة `lab_treasury_map_payment(text)` تحوّل أي نص إلى enum `lab_treasury_payment_method`.

## التقارير (RPC)
- `lab_treasury_hatching_by_customer(from,to)`
- `lab_treasury_hatching_by_batch(from,to)`
- `lab_treasury_chicksales_by_batch(from,to)`
- `lab_treasury_chicksales_by_customer(from,to)`
- `lab_treasury_net_operation(from,to)` → jsonb بـ صافي التشغيل

## الواجهة
- عمود "المصدر" في سجل حركات الخزنة بزر "عرض المصدر" يفتح:
  - مدفوعات التفريخ → `/hatchery-payments`
  - بيع كتاكيت → `/modules/brooding`
- بطاقة "التقارير التشغيلية المرتبطة" في تبويب التقارير بـ 5 خيارات.

## Audit
كل حركة تلقائية تُسجل في `lab_treasury_audit_log` بـ `actor_name='system:trigger'`.
