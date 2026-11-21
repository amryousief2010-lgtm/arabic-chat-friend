export const CHAT_CATEGORY_LABELS: Record<string, string> = {
  price_inquiry: "استفسار سعر", order_request: "طلب شراء", product_info: "معلومات منتج", availability: "توفر",
  delivery_inquiry: "استفسار توصيل", complaint: "شكوى", followup: "متابعة", wholesale: "جملة", other: "أخرى",
};
export const CHAT_OUTCOME_LABELS: Record<string, string> = {
  order_placed: "تم الطلب", order_promised: "وعد بالطلب", inquiry_only: "استفسار فقط", not_interested: "غير مهتم",
  complaint: "شكوى", no_reply: "بدون رد", followup: "متابعة", other: "أخرى",
};
export const chatLabel = (m: Record<string, string>, k: string | null | undefined) => (k ? m[k] ?? k : "—");
export const fmtMin = (n: number | string | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(1)} د`);
