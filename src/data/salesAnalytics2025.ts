// Real 2025 sales analytics data extracted from the official analysis file

export const monthlySalesData = [
  { month: "يناير", sales: 1033605, orders: 394, momPercent: 0 },
  { month: "فبراير", sales: 1567534, orders: 826, momPercent: 51.7 },
  { month: "مارس", sales: 927916, orders: 488, momPercent: -40.8 },
  { month: "أبريل", sales: 823230, orders: 486, momPercent: -11.3 },
  { month: "مايو", sales: 1196154, orders: 639, momPercent: 45.3 },
  { month: "يونيو", sales: 636635, orders: 311, momPercent: -46.8 },
  { month: "يوليو", sales: 1223935, orders: 766, momPercent: 92.3 },
  { month: "أغسطس", sales: 1491726, orders: 1115, momPercent: 21.9 },
  { month: "سبتمبر", sales: 1260150, orders: 875, momPercent: -15.5 },
  { month: "أكتوبر", sales: 1023910, orders: 717, momPercent: -18.7 },
  { month: "نوفمبر", sales: 1022121, orders: 663, momPercent: -0.2 },
  { month: "ديسمبر", sales: 1233511, orders: 715, momPercent: 20.7 },
];

export const governorateSalesData = [
  { name: "القاهرة", sales: 5041772, orders: 3202, percent: 37.5 },
  { name: "الجيزة", sales: 1847942, orders: 1249, percent: 13.7 },
  { name: "الغربية", sales: 1575427, orders: 1073, percent: 11.7 },
  { name: "الإسكندرية", sales: 1253208, orders: 380, percent: 9.3 },
  { name: "الدقهلية", sales: 839966, orders: 477, percent: 6.2 },
  { name: "الشرقية", sales: 663014, orders: 406, percent: 4.9 },
  { name: "القليوبية", sales: 632564, orders: 406, percent: 4.7 },
  { name: "المنوفية", sales: 447913, orders: 262, percent: 3.3 },
  { name: "البحيرة", sales: 269096, orders: 181, percent: 2.0 },
  { name: "كفر الشيخ", sales: 248030, orders: 142, percent: 1.8 },
];

export const customerSourcesData = [
  { name: "مكالمة/واتساب", value: 58.3, orders: 3957 },
  { name: "حملات فيسبوك", value: 19.6, orders: 2121 },
  { name: "فيسبوك", value: 18.2, orders: 1585 },
  { name: "حملات واتس", value: 2.7, orders: 251 },
  { name: "تيك توك", value: 0.4, orders: 27 },
  { name: "أخرى", value: 0.8, orders: 54 },
];

export const shippingCompanyData = [
  { name: "مندوب خاص", value: 43.6, orders: 3328 },
  { name: "زودكس", value: 40.0, orders: 3522 },
  { name: "العاصمة", value: 9.0, orders: 869 },
  { name: "مندوب من المزرعة", value: 4.1, orders: 100 },
  { name: "استلام من المزرعة", value: 3.2, orders: 168 },
];

export const moderatorPerformanceData = [
  { name: "أية", sales: 5906181, orders: 3126, percent: 43.9 },
  { name: "هبة", sales: 2192883, orders: 1564, percent: 16.3 },
  { name: "رانيا", sales: 1816398, orders: 1025, percent: 13.5 },
  { name: "سارة", sales: 1779863, orders: 1235, percent: 13.2 },
  { name: "سهيلة", sales: 1014093, orders: 606, percent: 7.5 },
  { name: "نورا", sales: 542500, orders: 366, percent: 4.0 },
  { name: "أخرى", sales: 188509, orders: 73, percent: 1.6 },
];

export const topProductsData = [
  { name: "اللحم", quantity: 11185 },
  { name: "برجر", quantity: 7259 },
  { name: "كفتة", quantity: 7054 },
  { name: "سجق", quantity: 6780 },
  { name: "مفروم حواوشي", quantity: 6630 },
  { name: "الاستيك", quantity: 5668 },
  { name: "الموزه", quantity: 4388 },
  { name: "الرقاب", quantity: 4363 },
  { name: "شاورما", quantity: 2903 },
  { name: "مفروم", quantity: 2783 },
];

export const summary2025 = {
  totalSales: 13440427,
  totalOrders: 7995,
  totalCustomers: 5263,
  avgOrderValue: 1681,
  bestMonth: "فبراير",
  bestMonthSales: 1567534,
  bestGovernorate: "القاهرة",
  bestModerator: "أية",
  bestSource: "مكالمة/واتساب",
};
