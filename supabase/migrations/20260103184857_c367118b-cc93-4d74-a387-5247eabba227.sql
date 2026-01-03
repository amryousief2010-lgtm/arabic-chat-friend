-- Create products table
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  unit TEXT NOT NULL DEFAULT 'كجم',
  stock INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create customers table
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_spent DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  delivery_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  delivery_address TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create order_items table
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for products (all authenticated can read, admin/supervisor can write)
CREATE POLICY "Authenticated users can view products"
  ON public.products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and supervisors can manage products"
  ON public.products FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'supervisor')
  );

-- RLS Policies for customers (all authenticated can read/write)
CREATE POLICY "Authenticated users can view customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create customers"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Admins and supervisors can update customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'supervisor')
  );

-- RLS Policies for orders
CREATE POLICY "Authenticated users can view orders"
  ON public.orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create orders"
  ON public.orders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins and supervisors can update orders"
  ON public.orders FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'supervisor')
  );

-- RLS Policies for order_items
CREATE POLICY "Authenticated users can view order items"
  ON public.order_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create order items"
  ON public.order_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create triggers for updated_at
CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to generate order number
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_number TEXT;
  counter INTEGER;
BEGIN
  SELECT COUNT(*) + 1 INTO counter FROM public.orders;
  new_number := 'ORD-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(counter::TEXT, 4, '0');
  RETURN new_number;
END;
$$;

-- Insert sample products
INSERT INTO public.products (name, description, price, unit, stock, category) VALUES
('لحم نعام طازج', 'لحم نعام طازج عالي الجودة', 450.00, 'كجم', 50, 'لحوم'),
('ستيك نعام', 'شرائح ستيك نعام ممتازة', 520.00, 'كجم', 30, 'لحوم'),
('لحم نعام مفروم', 'لحم نعام مفروم طازج', 380.00, 'كجم', 40, 'لحوم'),
('دهن نعام', 'دهن نعام طبيعي 100%', 250.00, 'لتر', 25, 'دهون'),
('زيت نعام', 'زيت نعام للعناية بالبشرة', 180.00, '100مل', 60, 'زيوت'),
('كبدة نعام', 'كبدة نعام طازجة', 320.00, 'كجم', 20, 'لحوم');

-- Insert sample customers
INSERT INTO public.customers (name, phone, email, address, city) VALUES
('أحمد محمد علي', '01012345678', 'ahmed@example.com', '15 شارع التحرير', 'القاهرة'),
('محمد حسن', '01098765432', 'mohamed@example.com', '22 شارع الهرم', 'الجيزة'),
('سارة أحمد', '01155544433', 'sara@example.com', '10 شارع النيل', 'الإسكندرية');