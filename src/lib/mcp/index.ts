import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listOrdersTool from "./tools/list-orders";
import getOrderTool from "./tools/get-order";
import salesSummaryTool from "./tools/sales-summary";
import listProductsTool from "./tools/list-products";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "naam-al-asima-management-system",
  title: "Naam Al-Asima Management System",
  version: "0.1.0",
  instructions:
    "Read-only tools for the Naam Al-Asima (Capital Ostrich) management system. Use `list_orders` and `get_order` for order data, `sales_summary` for aggregated sales over a date range, and `list_products` for products, prices and stock. All data access runs as the signed-in user with their own permissions.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listOrdersTool, getOrderTool, salesSummaryTool, listProductsTool],
});
