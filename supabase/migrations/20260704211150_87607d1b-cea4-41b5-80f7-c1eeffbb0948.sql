
CREATE TABLE public.zodex_closed_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null,
  shipper_id integer not null default 215,
  shipper_name text,
  total_amount numeric(12,2) not null default 0,
  orders_count integer not null default 0,
  orders_matched integer not null default 0,
  orders_missing integer not null default 0,
  custody_id uuid,
  first_seen_at timestamptz not null default now(),
  processed_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  UNIQUE(invoice_no, shipper_id)
);
GRANT SELECT ON public.zodex_closed_invoices TO authenticated;
GRANT ALL ON public.zodex_closed_invoices TO service_role;
ALTER TABLE public.zodex_closed_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zodex_closed_invoices_read" ON public.zodex_closed_invoices FOR SELECT TO authenticated USING (true);

CREATE TABLE public.zodex_closed_invoice_orders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.zodex_closed_invoices(id) on delete cascade,
  order_id uuid,
  bill_no text not null,
  customer_phone text,
  moderator_name text,
  cod_amount numeric(12,2) not null default 0,
  matched boolean not null default false,
  custody_assigned boolean not null default false,
  created_at timestamptz not null default now(),
  UNIQUE(invoice_id, bill_no)
);
GRANT SELECT ON public.zodex_closed_invoice_orders TO authenticated;
GRANT ALL ON public.zodex_closed_invoice_orders TO service_role;
ALTER TABLE public.zodex_closed_invoice_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zodex_closed_invoice_orders_read" ON public.zodex_closed_invoice_orders FOR SELECT TO authenticated USING (true);

CREATE INDEX zodex_closed_invoice_orders_invoice_idx ON public.zodex_closed_invoice_orders(invoice_id);
CREATE INDEX zodex_closed_invoices_first_seen_idx ON public.zodex_closed_invoices(first_seen_at DESC);
