export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  image: string;
  unit: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  total: number;
  status: "pending" | "processing" | "shipped" | "delivered" | "cancelled";
  paymentMethod: "cash" | "online";
  paymentStatus: "pending" | "paid" | "failed";
  createdAt: string;
  deliveryAddress: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  totalOrders: number;
  totalSpent: number;
  createdAt: string;
}

export interface SalesData {
  month: string;
  sales: number;
  orders: number;
}

export type OrderStatus = Order["status"];
export type PaymentMethod = Order["paymentMethod"];
export type PaymentStatus = Order["paymentStatus"];
