import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listOrdersTool from "./tools/list-orders";
import getOrderTool from "./tools/get-order";
import salesSummaryTool from "./tools/sales-summary";
import listProductsTool from "./tools/list-products";
import systemMapTool from "./tools/system-map";
import listDatasetsTool from "./tools/list-datasets";
import queryDatasetTool from "./tools/query-dataset";
import getRecordTool from "./tools/get-record";
import inventoryBalancesTool from "./tools/inventory-balances";
import inventoryMovementsTool from "./tools/inventory-movements";
import salesReportTool from "./tools/sales-report";
import manufacturingReportTool from "./tools/manufacturing-report";
import financeReportTool from "./tools/finance-report";
import hrReportTool from "./tools/hr-report";
import customersReportTool from "./tools/customers-report";
import deliveryReportTool from "./tools/delivery-report";
import marketingReportTool from "./tools/marketing-report";
import messagesAndDocumentsTool from "./tools/messages-and-documents";
import meatFactoryReportTool from "./tools/meat-factory-report";


const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "naam-al-asima-management-system",
  title: "Naam Al-Asima Management System",
  version: "0.4.0",
  instructions:
    "أدوات قراءة فقط لنظام إدارة نعام العاصمة (Capital Ostrich). ابدأ دائمًا بـ `system_map` لفهم الأقسام وقواعد العمل، ثم `list_datasets` لمعرفة الأعمدة، ثم `query_dataset` للاستعلام العام مع الترقيم والعدد الإجمالي، و`get_record` لتفاصيل سجل وسجلاته المرتبطة. للمخزون استخدم `inventory_balances` و`inventory_movements` (وليس products.stock). للتقارير الجاهزة: `sales_report` (يفصل قيمة الطلبات عن المبيعات المسلّمة عن التحصيل)، `manufacturing_report`، `meat_factory_report` (تقرير مصنع اللحوم الشامل بكل فروعه: التصنيع والدفعات والمخزون والمشتريات والمبيعات والمرتجعات والتحويلات والعجينة المرحّلة والجرد والخزينة والوصفات والمنتجات)، `finance_report`، `hr_report` (الموظفون والخصومات والرواتب)، `customers_report` (تحليل العملاء)، `delivery_report` (الشحن والمناديب والتحصيل)، `marketing_report` (التارجت وأداء المودريتور والسوشيال ميديا والإعلانات)، و`messages_and_documents` (الرسائل الداخلية والمرفقات ومستندات الموظفين كبيانات وصفية فقط). العملة الجنيه المصري، الأوزان بالكيلو، التواريخ UTC والعمل التشغيلي بتوقيت القاهرة. كل القراءات تنفذ بصلاحيات المستخدم الموقّع (RLS) ولا توجد أدوات تعديل أو حذف.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    systemMapTool,
    listDatasetsTool,
    queryDatasetTool,
    getRecordTool,
    inventoryBalancesTool,
    inventoryMovementsTool,
    listProductsTool,
    listOrdersTool,
    getOrderTool,
    salesSummaryTool,
    salesReportTool,
    manufacturingReportTool,
    financeReportTool,
    hrReportTool,
    customersReportTool,
    deliveryReportTool,
    marketingReportTool,
    messagesAndDocumentsTool,
  ],
});
