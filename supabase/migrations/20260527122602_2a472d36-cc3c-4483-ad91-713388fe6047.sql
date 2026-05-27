-- Drop redundant RLS policies that cause per-row EXISTS evaluation, slowing down reads for sales moderators
-- "view all customers" already covers them, and "view items of their assigned orders" already covers their own.
DROP POLICY IF EXISTS "Sales moderators view their own customers" ON public.customers;
DROP POLICY IF EXISTS "Sales moderators can view their own order items" ON public.order_items;