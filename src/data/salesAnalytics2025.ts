// Real 2025 sales analytics data extracted from the analysis file

export const monthlySalesData = [
  { month: "يناير", sales: 1033605, orders: 394, momPercent: 0 },
  { month: "فبراير", sales: 1567534, orders: 826, momPercent: 51.7 },
  { month: "مارس", sales: 927916, orders: 488, momPercent: -40.8 },
  { month: "أبريل", sales: 1079752, orders: 589, momPercent: 16.4 },
  { month: "مايو", sales: 1321614, orders: 714, momPercent: 22.4 },
  { month: "يونيو", sales: 1349975, orders: 753, momPercent: 2.1 },
  { month: "يوليو", sales: 1275854, orders: 780, momPercent: -5.5 },
  { month: "أغسطس", sales: 1191218, orders: 783, momPercent: -6.6 },
  { month: "سبتمبر", sales: 1072701, orders: 739, momPercent: -9.9 },
  { month: "أكتوبر", sales: 1198690, orders: 838, momPercent: 11.7 },
  { month: "نوفمبر", sales: 882720, orders: 657, momPercent: -26.3 },
  { month: "ديسمبر", sales: 538848, orders: 434, momPercent: -39.0 },
];

export const governorateSalesData = [
  { name: "القاهرة", sales: 5041772, orders: 2908, percent: 37.5 },
  { name: "الجيزة", sales: 1847942, orders: 1090, percent: 13.7 },
  { name: "الغربية", sales: 1575427, orders: 1016, percent: 11.7 },
  { name: "القليوبية", sales: 861508, orders: 488, percent: 6.4 },
  { name: "الشرقية", sales: 653281, orders: 370, percent: 4.9 },
  { name: "المنوفية", sales: 603730, orders: 371, percent: 4.5 },
  { name: "البحيرة", sales: 504860, orders: 291, percent: 3.8 },
  { name: "الدقهلية", sales: 436905, orders: 264, percent: 3.3 },
  { name: "الإسكندرية", sales: 387940, orders: 244, percent: 2.9 },
  { name: "الفيوم", sales: 298880, orders: 158, percent: 2.2 },
  { name: "أخرى", sales: 1228182, orders: 795, percent: 9.1 },
];

export const customerSourcesData = [
  { name: "مكالمة/واتساب", value: 58.3, orders: 4661 },
  { name: "حملات فيسبوك", value: 19.6, orders: 1567 },
  { name: "فيسبوك", value: 18.2, orders: 1455 },
  { name: "تيك توك", value: 2.0, orders: 160 },
  { name: "موقع", value: 1.1, orders: 88 },
  { name: "أخرى", value: 0.8, orders: 64 },
];

export const shippingCompanyData = [
  { name: "مندوب خاص", value: 43.6, orders: 3486 },
  { name: "زودكس", value: 40.0, orders: 3198 },
  { name: "العاصمة", value: 9.0, orders: 719 },
  { name: "أخرى", value: 7.4, orders: 592 },
];

export const moderatorPerformanceData = [
  { name: "أية", sales: 5906181, orders: 3511, percent: 43.9 },
  { name: "هبة", sales: 2192883, orders: 1333, percent: 16.3 },
  { name: "رانيا", sales: 1711697, orders: 1063, percent: 12.7 },
  { name: "سارة", sales: 1507696, orders: 812, percent: 11.2 },
  { name: "فاطمة", sales: 791102, orders: 443, percent: 5.9 },
  { name: "يوسف", sales: 589350, orders: 342, percent: 4.4 },
  { name: "أخرى", sales: 741518, orders: 491, percent: 5.6 },
];

export const topProductsData = [
  { name: "كريم للبشرة", quantity: 15489 },
  { name: "اللحم", quantity: 11185 },
  { name: "برجر", quantity: 7259 },
  { name: "سجق", quantity: 5812 },
  { name: "كفتة", quantity: 4935 },
  { name: "كبدة", quantity: 4201 },
  { name: "دهن", quantity: 3876 },
  { name: "لانشون سادة", quantity: 3214 },
  { name: "كريم المفاصل", quantity: 2987 },
  { name: "زيت الشعر", quantity: 2654 },
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
