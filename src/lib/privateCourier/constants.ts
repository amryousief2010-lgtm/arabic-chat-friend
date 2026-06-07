// Private Courier module — shared constants
export type CourierStatus =
  | "assigned_to_courier"
  | "ready_for_pickup_from_main_warehouse"
  | "picked_up_by_courier"
  | "out_for_delivery"
  | "delivered"
  | "failed_delivery"
  | "returned_to_warehouse"
  | "cancelled";

export type RouteStatus = "draft" | "planned" | "in_progress" | "completed" | "cancelled";

export type CollectionStatus =
  | "cash_collected"
  | "partial_collected"
  | "not_collected"
  | "mismatch"
  | "paid_online"
  | "returned_no_collection";

export type FailedReason =
  | "customer_unavailable"
  | "address_unclear"
  | "customer_refused"
  | "customer_postponed"
  | "product_unsuitable"
  | "wrong_phone"
  | "out_of_delivery_area"
  | "other";

export type NextAction = "reschedule" | "return_to_warehouse" | "cancel_order" | "manager_review";

export const COURIER_STATUS_LABEL: Record<CourierStatus, string> = {
  assigned_to_courier: "مُعيَّن للمندوب",
  ready_for_pickup_from_main_warehouse: "جاهز للاستلام من المخزن الرئيسي",
  picked_up_by_courier: "تم الاستلام",
  out_for_delivery: "خرج للتوصيل",
  delivered: "تم التوصيل",
  failed_delivery: "فشل التوصيل",
  returned_to_warehouse: "مرتجع للمخزن",
  cancelled: "ملغي",
};

export const COURIER_STATUS_COLOR: Record<CourierStatus, string> = {
  assigned_to_courier: "bg-blue-500/10 text-blue-700 border-blue-300",
  ready_for_pickup_from_main_warehouse: "bg-amber-500/10 text-amber-700 border-amber-300",
  picked_up_by_courier: "bg-indigo-500/10 text-indigo-700 border-indigo-300",
  out_for_delivery: "bg-purple-500/10 text-purple-700 border-purple-300",
  delivered: "bg-green-500/10 text-green-700 border-green-300",
  failed_delivery: "bg-red-500/10 text-red-700 border-red-300",
  returned_to_warehouse: "bg-orange-500/10 text-orange-700 border-orange-300",
  cancelled: "bg-gray-500/10 text-gray-700 border-gray-300",
};

export const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = {
  draft: "مسودة",
  planned: "مخطط",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  cancelled: "ملغي",
};

export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  cash_collected: "تم التحصيل نقداً",
  partial_collected: "تحصيل جزئي",
  not_collected: "لم يُحصَّل",
  mismatch: "اختلاف في المبلغ",
  paid_online: "مدفوع أونلاين",
  returned_no_collection: "مرتجع بدون تحصيل",
};

export const FAILED_REASON_LABEL: Record<FailedReason, string> = {
  customer_unavailable: "العميل غير متاح",
  address_unclear: "العنوان غير واضح",
  customer_refused: "العميل رفض الاستلام",
  customer_postponed: "تأجيل من العميل",
  product_unsuitable: "المنتج غير مناسب",
  wrong_phone: "رقم الهاتف غير صحيح",
  out_of_delivery_area: "خارج نطاق التوصيل",
  other: "سبب آخر",
};

export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  reschedule: "إعادة جدولة",
  return_to_warehouse: "إرجاع للمخزن",
  cancel_order: "إلغاء الطلب",
  manager_review: "مراجعة المدير",
};

export const REGIONS = [
  "القاهرة الكبرى",
  "الدلتا",
  "الإسكندرية والساحل",
  "القناة وسيناء",
  "الصعيد",
  "خط خاص / غير محدد",
] as const;

export const ROUTE_COLORS = [
  "#8b5cf6", "#f97316", "#10b981", "#3b82f6",
  "#ec4899", "#f59e0b", "#06b6d4", "#ef4444",
];
